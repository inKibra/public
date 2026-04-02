import {
  type IParsedTokenObject,
  issueJWT,
  validateJWT,
} from '@inkibra/crypto-jwt-claim';
import type { Logger } from '@inkibra/logger';
import type { TRequest, TResponse } from './safe-express';

/**
 * Configuration for the TokenHandler.
 */
export type TokenHandlerConfig = {
  /**
   * The issuer of the token.
   * @example 'inkibra'
   */
  issuer: string;
  /**
   * The secret used to sign the token.
   */
  secret: string;
  /**
   * A mapping of subdomains to domains for setting cookies.
   */
  domainMapping?: Record<string, string>;
};

/**
 * A class that handles signing and parsing JWT tokens.
 */
export class TokenHandler<TData, TSubject extends string = string> {
  private issuer: string;
  private secret: string;
  private domainMapping?: Record<string, string>;
  constructor(config: TokenHandlerConfig) {
    this.issuer = config.issuer;
    this.secret = config.secret;
    this.domainMapping = config.domainMapping;
  }
  /**
   * A function that sets a token on the response object.
   * @param hostname The hostname of the request.
   * @param res The response object to set the cookie on.
   * @param subject The subject of the token such as a user or organization.
   * @param data Extra data to include in the token.
   * @param expirationSeconds The number of seconds until the token expires.
   * @returns A promise that resolves to the token string and token object.
   */
  public async setToken<TSetData extends TData>(
    logger: Logger,
    hostname: string,
    res: TResponse<unknown> | undefined,
    subject: TSubject,
    data: TSetData,
    expirationSeconds = 60,
  ) {
    logger.trace('Setting token', {
      hostname,
      subject,
      data,
      expirationSeconds,
    });
    const { tokenString, tokenObject } = await issueJWT(
      this.secret,
      this.issuer,
      subject,
      data,
      expirationSeconds / 60,
    );
    if (res) {
      res.cookie('Authorization', tokenString, {
        domain: this.domainMapping?.[hostname],
        sameSite: 'none',
        httpOnly: true,
        secure: true,
        expires: new Date(Date.now() + expirationSeconds * 1000),
      });
      res.removeHeader('X-Use-Authorization');
      res.setHeader('X-Use-Authorization', tokenString);
      res.cookie('Subject', subject, {
        domain: this.domainMapping?.[hostname],
        sameSite: 'none',
        httpOnly: true,
        secure: true,
        expires: new Date(Date.now() + expirationSeconds * 1000),
      });
    }
    return { tokenString, tokenObject };
  }

  /**
   * Gets all Authorization cookie values from the request.
   * Returns them in order they appear in the Cookie header.
   */
  private getAllAuthorizationCookies(req: TRequest): string[] {
    const cookieHeader = req.header('Cookie');
    if (!cookieHeader) {
      const singleCookie = req.cookies.Authorization as string | undefined;
      return singleCookie ? [singleCookie] : [];
    }

    // Parse all cookies and filter for Authorization cookies
    const authCookies: string[] = [];
    const cookies = cookieHeader.split(';');

    for (const cookie of cookies) {
      const trimmed = cookie.trim();
      if (trimmed.startsWith('Authorization=')) {
        const value = trimmed.substring('Authorization='.length);
        if (value) {
          authCookies.push(value);
        }
      }
    }

    return authCookies;
  }
  /**
   * A function that parses a token from the request object.
   * @param req The request object to parse the token from.
   * @param clockTolerance The clock tolerance in milliseconds.
   * @returns A promise that resolves to the parsed token object or undefined if no token was found.
   */

  public async parseToken(
    logger: Logger,
    req: TRequest,
    clockTolerance?: number,
  ): Promise<IParsedTokenObject<TData> | undefined> {
    const authenticationQuery = req.query.authorization;
    const authorizationHeader = req
      .header('Authorization')
      ?.replace('Bearer ', '');
    const authorizationCookies = this.getAllAuthorizationCookies(req);
    logger.trace('Authorization header', {
      authorizationHeader,
      authorizationCookies,
    });

    if (typeof authenticationQuery === 'string') {
      logger.trace('Authentication query', {
        authenticationQuery,
      });
      try {
        return await validateJWT(
          this.secret,
          this.issuer,
          JSON.parse(authenticationQuery) as string,
          clockTolerance,
        );
      } catch {
        logger.error('Failed to parse token (continue with next cookie)', {
          authenticationQuery,
        });
      }
    }

    if (authorizationHeader) {
      try {
        return await validateJWT(
          this.secret,
          this.issuer,
          authorizationHeader,
          clockTolerance,
        );
      } catch {
        logger.error('Failed to parse token (continue with cookie)', {
          authorizationCookies,
          authorizationHeader,
        });
      }
    }

    for (const authorization of authorizationCookies) {
      try {
        return await validateJWT(
          this.secret,
          this.issuer,
          authorization,
          clockTolerance,
        );
      } catch {
        logger.debug('Failed to parse token (continue with next cookie)', {
          authorizationCookie: authorization,
          authorizationCookies,
          authorizationHeader,
        });
      }
    }

    if (authorizationCookies.length > 0 || authorizationHeader) {
      logger.error('Failed to parse token', {
        authorizationCookies,
        authorizationHeader,
      });
    } else {
      logger.debug('No authorization found', {
        authorizationCookies,
        authorizationHeader,
      });
    }
    return undefined;
  }
}
