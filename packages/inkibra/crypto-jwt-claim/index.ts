import { StatusCode } from '@inkibra/api-base';
import { defineError, toThrowable } from '@inkibra/error-base';
import * as jwt from 'jsonwebtoken';
import * as uuid from 'uuid';

export const TokenExpired =
  defineError(
    'TOKEN_EXPIRED',
  ).message<'The jwt token that was in use expired'>();

export { jwt };

interface ITokenObject<TData> {
  iss: string;
  sub: string;
  aud: string[];
  jti: string;
  iat: number;
  exp: number;
  payload: TData;
}
export interface IParsedTokenObject<TData> {
  iss: string;
  sub: string;
  aud: string[];
  jti: string;
  iat: Date;
  exp: Date;
  payload: TData;
}

export async function issueJWT<TData>(
  secret: string,
  issuer: string,
  subject: string,
  payload: TData,
  expirationMinutes = 30,
) {
  const iss = issuer;
  const sub = subject;
  const aud = [iss, sub];
  const jti = uuid.v4();
  const iat = new Date();
  const exp = new Date(iat.getTime() + expirationMinutes * 60000);
  const tokenObject = {
    iss,
    sub,
    aud,
    jti,
    iat,
    exp,
    payload,
  };
  return new Promise<{
    tokenString: string;
    tokenObject: IParsedTokenObject<TData>;
  }>((resolve, reject) => {
    jwt.sign(
      {
        ...tokenObject,
        iat: Math.floor(iat.getTime() / 1000),
        exp: Math.floor(exp.getTime() / 1000),
      },
      secret,
      { algorithm: 'HS512' },
      (err, tokenString) => {
        if (err || !tokenString) {
          return reject(err);
        }
        return resolve({ tokenString, tokenObject });
      },
    );
  });
}

function isValidToken(
  decodedToken: string | object,
): decodedToken is ITokenObject<unknown> {
  if (
    typeof decodedToken === 'object' &&
    typeof (decodedToken as ITokenObject<unknown>).sub === 'string' &&
    typeof (decodedToken as ITokenObject<unknown>).aud === 'object' &&
    Array.isArray((decodedToken as ITokenObject<unknown>).aud) &&
    typeof (decodedToken as ITokenObject<unknown>).jti === 'string' &&
    typeof (decodedToken as ITokenObject<unknown>).iat === 'number' &&
    typeof (decodedToken as ITokenObject<unknown>).exp === 'number'
  ) {
    return true;
  }
  return false;
}

// TODO: pass validate token a payload validation function
export async function validateJWT<T>(
  secret: string,
  issuer: string,
  token: string,
  clockTolerance = 0,
  ignoreExpiration = false,
) {
  return new Promise<IParsedTokenObject<T>>((resolve, reject) => {
    jwt.verify(
      token,
      secret,
      { algorithms: ['HS512'], clockTolerance, ignoreExpiration, issuer },
      (err, verifiedToken) => {
        if (err) {
          if (err instanceof jwt.TokenExpiredError) {
            return reject(
              toThrowable(
                TokenExpired.create(
                  'The jwt token that was in use expired',
                  {},
                ),
                StatusCode.NOT_AUTHENTICATED,
              ),
            );
          }
          return reject(err);
        }
        if (verifiedToken && isValidToken(verifiedToken)) {
          return resolve({
            ...verifiedToken,
            iat: new Date(verifiedToken.iat * 1000),
            exp: new Date(verifiedToken.exp * 1000),
          } as IParsedTokenObject<T>); // TODO: type check the payload data
        }
        return reject(new Error('invalid token')); // TODO: use error base
      },
    );
  });
}
