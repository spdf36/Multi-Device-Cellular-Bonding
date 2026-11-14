'use strict';
/**
 * src/logger.js
 * Minimal structured logger used throughout the hub.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const ENV_LEVEL = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function createLogger(name) {
  const prefix = `[${name}]`;

  function write(level, ...args) {
    if (LEVELS[level] > ENV_LEVEL) return;
    const ts = new Date().toISOString();
    const line = `${ts} ${level.toUpperCase().padEnd(5)} ${prefix}`;
    if (level === 'error') {
      console.error(line, ...args);
    } else {
      console.log(line, ...args);
    }
  }

  return {
    error : (...a) => write('error', ...a),
    warn  : (...a) => write('warn',  ...a),
    info  : (...a) => write('info',  ...a),
    debug : (...a) => write('debug', ...a),
  };
}

module.exports = { createLogger };
