/**
 * Database Logger Implementation
 * 
 * Provides unified logging for the database abstraction layer with
 * configurable log levels, formatting, and output destinations.
 */

import { DatabaseLogger } from './interfaces.js';

/**
 * Log levels in order of severity
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4
}

/**
 * Log entry interface
 */
export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  meta?: any;
  error?: Error;
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  level: LogLevel;
  prefix?: string;
  includeTimestamp?: boolean;
  includeLevel?: boolean;
  colorize?: boolean;
  maxMetaLength?: number;
}

/**
 * Console logger implementation with formatting and color support
 */
export class ConsoleLogger implements DatabaseLogger {
  private config: LoggerConfig;
  private static readonly COLORS = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
  };

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: LogLevel.INFO,
      prefix: '[DB]',
      includeTimestamp: true,
      includeLevel: true,
      colorize: true,
      maxMetaLength: 500,
      ...config
    };
  }

  debug(message: string, meta?: any): void {
    this.log(LogLevel.DEBUG, message, meta);
  }

  info(message: string, meta?: any): void {
    this.log(LogLevel.INFO, message, meta);
  }

  warn(message: string, meta?: any): void {
    this.log(LogLevel.WARN, message, meta);
  }

  error(message: string, error?: Error, meta?: any): void {
    this.log(LogLevel.ERROR, message, meta, error);
  }

  /**
   * Set log level
   */
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  /**
   * Get current log level
   */
  getLevel(): LogLevel {
    return this.config.level;
  }

  /**
   * Check if a log level is enabled
   */
  isLevelEnabled(level: LogLevel): boolean {
    return level >= this.config.level;
  }

  /**
   * Update logger configuration
   */
  updateConfig(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Internal log method
   */
  private log(level: LogLevel, message: string, meta?: any, error?: Error): void {
    if (!this.isLevelEnabled(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      message,
      meta,
      error
    };

    const formattedMessage = this.formatLogEntry(entry);
    this.output(level, formattedMessage);
  }

  /**
   * Format a log entry
   */
  private formatLogEntry(entry: LogEntry): string {
    const parts: string[] = [];

    // Timestamp
    if (this.config.includeTimestamp) {
      const timestamp = entry.timestamp.toISOString();
      parts.push(this.colorize(timestamp, 'gray'));
    }

    // Prefix
    if (this.config.prefix) {
      parts.push(this.colorize(this.config.prefix, this.getLevelColor(entry.level)));
    }

    // Level
    if (this.config.includeLevel) {
      const levelName = LogLevel[entry.level];
      parts.push(this.colorize(levelName, this.getLevelColor(entry.level)));
    }

    // Message
    parts.push(this.colorize(entry.message, this.getLevelColor(entry.level)));

    let result = parts.join(' ');

    // Meta information
    if (entry.meta !== undefined && entry.meta !== null && entry.meta !== '') {
      const metaStr = this.formatMeta(entry.meta);
      if (metaStr) {
        result += ' ' + this.colorize(metaStr, 'dim');
      }
    }

    // Error information
    if (entry.error) {
      result += '\n' + this.formatError(entry.error);
    }

    return result;
  }

  /**
   * Format meta information
   */
  private formatMeta(meta: any): string {
    try {
      if (typeof meta === 'string') {
        return meta;
      }

      if (typeof meta === 'object') {
        let metaStr = JSON.stringify(meta, null, 2);
        
        // Truncate if too long
        if (this.config.maxMetaLength && metaStr.length > this.config.maxMetaLength) {
          metaStr = metaStr.substring(0, this.config.maxMetaLength) + '...';
        }
        
        return metaStr;
      }

      return String(meta);
    } catch (error) {
      return '[Unable to serialize meta]';
    }
  }

  /**
   * Format error information
   */
  private formatError(error: Error): string {
    const parts: string[] = [];
    
    // Error name and message
    parts.push(this.colorize(`${error.name}: ${error.message}`, 'red'));
    
    // Stack trace
    if (error.stack) {
      const stackLines = error.stack.split('\n').slice(1); // Skip first line (already shown)
      const formattedStack = stackLines
        .map(line => '  ' + line.trim())
        .join('\n');
      parts.push(this.colorize(formattedStack, 'gray'));
    }

    return parts.join('\n');
  }

  /**
   * Get color for log level
   */
  private getLevelColor(level: LogLevel): keyof typeof ConsoleLogger.COLORS {
    switch (level) {
      case LogLevel.DEBUG:
        return 'cyan';
      case LogLevel.INFO:
        return 'green';
      case LogLevel.WARN:
        return 'yellow';
      case LogLevel.ERROR:
        return 'red';
      default:
        return 'white';
    }
  }

  /**
   * Apply color to text
   */
  private colorize(text: string, color: keyof typeof ConsoleLogger.COLORS): string {
    if (!this.config.colorize) {
      return text;
    }

    const colorCode = ConsoleLogger.COLORS[color];
    const resetCode = ConsoleLogger.COLORS.reset;
    return `${colorCode}${text}${resetCode}`;
  }

  /**
   * Output the formatted message
   */
  private output(level: LogLevel, message: string): void {
    switch (level) {
      case LogLevel.DEBUG:
        console.debug(message);
        break;
      case LogLevel.INFO:
        console.log(message);
        break;
      case LogLevel.WARN:
        console.warn(message);
        break;
      case LogLevel.ERROR:
        console.error(message);
        break;
    }
  }
}

/**
 * File logger implementation (writes to file)
 */
export class FileLogger implements DatabaseLogger {
  private config: LoggerConfig;
  private writeStream?: NodeJS.WritableStream;

  constructor(filePath: string, config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: LogLevel.INFO,
      prefix: '[DB]',
      includeTimestamp: true,
      includeLevel: true,
      colorize: false, // No colors in file output
      maxMetaLength: 1000,
      ...config
    };

    // Initialize file stream
    this.initializeFileStream(filePath);
  }

  debug(message: string, meta?: any): void {
    this.log(LogLevel.DEBUG, message, meta);
  }

  info(message: string, meta?: any): void {
    this.log(LogLevel.INFO, message, meta);
  }

  warn(message: string, meta?: any): void {
    this.log(LogLevel.WARN, message, meta);
  }

  error(message: string, error?: Error, meta?: any): void {
    this.log(LogLevel.ERROR, message, meta, error);
  }

  /**
   * Close the file stream
   */
  close(): void {
    if (this.writeStream && 'end' in this.writeStream) {
      (this.writeStream as any).end();
    }
  }

  /**
   * Initialize file stream
   */
  private async initializeFileStream(filePath: string): Promise<void> {
    try {
      const fs = await import('fs');
      this.writeStream = fs.createWriteStream(filePath, { flags: 'a' });
      
      this.writeStream.on('error', (error) => {
        console.error('File logger error:', error);
      });
    } catch (error) {
      console.error('Failed to initialize file logger:', error);
    }
  }

  /**
   * Internal log method
   */
  private log(level: LogLevel, message: string, meta?: any, error?: Error): void {
    if (level < this.config.level) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      message,
      meta,
      error
    };

    const formattedMessage = this.formatLogEntry(entry);
    this.writeToFile(formattedMessage);
  }

  /**
   * Format log entry for file output
   */
  private formatLogEntry(entry: LogEntry): string {
    const parts: string[] = [];

    // Timestamp
    if (this.config.includeTimestamp) {
      parts.push(entry.timestamp.toISOString());
    }

    // Level
    if (this.config.includeLevel) {
      parts.push(`[${LogLevel[entry.level]}]`);
    }

    // Prefix
    if (this.config.prefix) {
      parts.push(this.config.prefix);
    }

    // Message
    parts.push(entry.message);

    let result = parts.join(' ');

    // Meta information
    if (entry.meta !== undefined && entry.meta !== null && entry.meta !== '') {
      const metaStr = this.formatMeta(entry.meta);
      if (metaStr) {
        result += ' ' + metaStr;
      }
    }

    // Error information
    if (entry.error) {
      result += '\n' + this.formatError(entry.error);
    }

    return result + '\n';
  }

  /**
   * Format meta information
   */
  private formatMeta(meta: any): string {
    try {
      if (typeof meta === 'string') {
        return meta;
      }

      if (typeof meta === 'object') {
        let metaStr = JSON.stringify(meta);
        
        // Truncate if too long
        if (this.config.maxMetaLength && metaStr.length > this.config.maxMetaLength) {
          metaStr = metaStr.substring(0, this.config.maxMetaLength) + '...';
        }
        
        return metaStr;
      }

      return String(meta);
    } catch (error) {
      return '[Unable to serialize meta]';
    }
  }

  /**
   * Format error information
   */
  private formatError(error: Error): string {
    const parts: string[] = [];
    
    // Error name and message
    parts.push(`${error.name}: ${error.message}`);
    
    // Stack trace
    if (error.stack) {
      parts.push(error.stack);
    }

    return parts.join('\n');
  }

  /**
   * Write to file
   */
  private writeToFile(message: string): void {
    if (this.writeStream) {
      this.writeStream.write(message);
    }
  }
}

/**
 * Multi-logger that writes to multiple destinations
 */
export class MultiLogger implements DatabaseLogger {
  private loggers: DatabaseLogger[];

  constructor(loggers: DatabaseLogger[]) {
    this.loggers = loggers;
  }

  debug(message: string, meta?: any): void {
    this.loggers.forEach(logger => logger.debug(message, meta));
  }

  info(message: string, meta?: any): void {
    this.loggers.forEach(logger => logger.info(message, meta));
  }

  warn(message: string, meta?: any): void {
    this.loggers.forEach(logger => logger.warn(message, meta));
  }

  error(message: string, error?: Error, meta?: any): void {
    this.loggers.forEach(logger => logger.error(message, error, meta));
  }

  /**
   * Add a logger
   */
  addLogger(logger: DatabaseLogger): void {
    this.loggers.push(logger);
  }

  /**
   * Remove a logger
   */
  removeLogger(logger: DatabaseLogger): void {
    const index = this.loggers.indexOf(logger);
    if (index > -1) {
      this.loggers.splice(index, 1);
    }
  }

  /**
   * Get all loggers
   */
  getLoggers(): DatabaseLogger[] {
    return [...this.loggers];
  }
}

/**
 * No-op logger for when logging is disabled
 */
export class NoOpLogger implements DatabaseLogger {
  debug(message: string, meta?: any): void {
    // No-op
  }

  info(message: string, meta?: any): void {
    // No-op
  }

  warn(message: string, meta?: any): void {
    // No-op
  }

  error(message: string, error?: Error, meta?: any): void {
    // No-op
  }
}

/**
 * Create a logger based on configuration
 */
export function createLogger(config: {
  type: 'console' | 'file' | 'multi' | 'none';
  level?: LogLevel;
  filePath?: string;
  loggers?: DatabaseLogger[];
  options?: Partial<LoggerConfig>;
}): DatabaseLogger {
  const { type, level = LogLevel.INFO, filePath, loggers, options = {} } = config;

  const loggerConfig: Partial<LoggerConfig> = {
    level,
    ...options
  };

  switch (type) {
    case 'console':
      return new ConsoleLogger(loggerConfig);
    
    case 'file':
      if (!filePath) {
        throw new Error('File path is required for file logger');
      }
      return new FileLogger(filePath, loggerConfig);
    
    case 'multi':
      if (!loggers || loggers.length === 0) {
        throw new Error('Loggers array is required for multi logger');
      }
      return new MultiLogger(loggers);
    
    case 'none':
      return new NoOpLogger();
    
    default:
      throw new Error(`Unknown logger type: ${type}`);
  }
}

/**
 * Default logger instance
 */
export const defaultLogger = new ConsoleLogger({
  level: LogLevel.INFO,
  prefix: '[RAG-DB]',
  colorize: true
});

/**
 * Export ConsoleLogger as DatabaseLogger for convenience
 */
export { ConsoleLogger as DatabaseLogger };

/**
 * Create a logger for development
 */
export function createDevelopmentLogger(): DatabaseLogger {
  return new ConsoleLogger({
    level: LogLevel.DEBUG,
    prefix: '[RAG-DB-DEV]',
    colorize: true,
    includeTimestamp: true
  });
}

/**
 * Create a logger for production
 */
export function createProductionLogger(logFilePath?: string): DatabaseLogger {
  const consoleLogger = new ConsoleLogger({
    level: LogLevel.INFO,
    prefix: '[RAG-DB]',
    colorize: false,
    includeTimestamp: true
  });

  if (logFilePath) {
    const fileLogger = new FileLogger(logFilePath, {
      level: LogLevel.DEBUG,
      prefix: '[RAG-DB]',
      includeTimestamp: true
    });

    return new MultiLogger([consoleLogger, fileLogger]);
  }

  return consoleLogger;
}
