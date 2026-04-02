import { GetEnvironmentEnum } from '@inkibra/environment';
import pino from 'pino';

export type LogLevel = 10 | 20 | 30 | 40 | 50 | 60;
export type LogLevelLiterals =
  | 'trace'
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'fatal';
export class Logger {
  private constructor(
    private readonly name: string,
    private readonly logger: pino.Logger,
  ) {}

  public static createLogger(
    name: string,
    bindings: Record<string, unknown>,
    level: LogLevelLiterals,
  ) {
    return new Logger(
      name,
      pino({
        level,
        serializers: Logger.stdSerializers,
      }).child({ ...bindings, name }),
    );
  }

  public static readonly stdSerializers = pino.stdSerializers;

  public static readonly nameFromLevel: Record<LogLevel, string> = {
    10: 'trace',
    20: 'debug',
    30: 'info',
    40: 'warn',
    50: 'error',
    60: 'fatal',
  };

  private streams: Array<{
    level: string;
    type: string;
    stream: { write: (rec: Object) => void };
  }> = [];

  public addStream(streamConfig: {
    level: LogLevelLiterals;
    type: string;
    stream: { write: (rec: Object) => void };
  }) {
    this.streams.push(streamConfig);
  }

  private logToStreams(level: LogLevel, rec: Object) {
    const levelName = Logger.nameFromLevel[level];
    this.streams.forEach((streamConfig) => {
      if (streamConfig.level === levelName) {
        streamConfig.stream.write(rec);
      }
    });
  }

  public info(message: string, args?: unknown) {
    const rec = {
      msg: message,
      level: 30,
      time: new Date().toISOString(),
      args,
    };
    this.logger.info(args, message);
    this.logToStreams(30, rec);
  }

  public debug(message: string, args?: unknown) {
    const rec = {
      msg: message,
      level: 20,
      time: new Date().toISOString(),
      args,
    };
    this.logger.debug(args, message);
    this.logToStreams(20, rec);
  }

  public trace(message: string, args?: unknown) {
    const rec = {
      msg: message,
      level: 10,
      time: new Date().toISOString(),
      args,
    };
    this.logger.trace(args, message);
    this.logToStreams(10, rec);
  }

  public fatal(message: string, args?: unknown) {
    const rec = {
      msg: message,
      level: 60,
      time: new Date().toISOString(),
      args,
    };
    this.logger.fatal(args, message);
    this.logToStreams(60, rec);
  }

  public error(message: string, args?: unknown) {
    const rec = {
      msg: message,
      level: 50,
      time: new Date().toISOString(),
      args,
    };
    this.logger.error(args, message);
    this.logToStreams(50, rec);
  }

  public warn(message: string, args?: unknown) {
    const rec = {
      msg: message,
      level: 40,
      time: new Date().toISOString(),
      args,
    };
    this.logger.warn(args, message);
    this.logToStreams(40, rec);
  }

  public child(bindings: Record<string, unknown> & { component: string }) {
    const newName = `${this.name}:${bindings.component}`;
    return new Logger(
      newName,
      this.logger.child({ ...bindings, name: newName }),
    );
  }
}

export function init(service: string) {
  const logger = Logger.createLogger(
    service,
    {
      serializers: Logger.stdSerializers,
    },
    GetEnvironmentEnum(
      'LOG_LEVEL',
      'info',
      'debug',
      'trace',
      'warn',
      'error',
      'fatal',
    ),
  );
  return logger;
}

export default init;
