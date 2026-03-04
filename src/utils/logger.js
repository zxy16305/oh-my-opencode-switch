import chalk from 'chalk';

class Logger {
  constructor(options = {}) {
    this.silent = options.silent || false;
    this.verbose = options.verbose || false;
  }

  info(message) {
    if (!this.silent) {
      console.log(chalk.blue('ℹ'), message);
    }
  }

  success(message) {
    if (!this.silent) {
      console.log(chalk.green('✓'), message);
    }
  }

  warn(message) {
    if (!this.silent) {
      console.warn(chalk.yellow('⚠'), message);
    }
  }

  error(message) {
    if (!this.silent) {
      console.error(chalk.red('✗'), message);
    }
  }

  debug(message) {
    if (!this.silent && this.verbose) {
      console.log(chalk.gray('›'), chalk.gray(message));
    }
  }

  raw(message) {
    if (!this.silent) {
      console.log(message);
    }
  }

  table(data, headers) {
    if (this.silent) return;

    if (headers) {
      console.log(chalk.bold(headers.join('\t')));
    }

    for (const row of data) {
      console.log(row.join('\t'));
    }
  }

  list(items) {
    if (this.silent) return;

    for (const item of items) {
      console.log(`  ${chalk.cyan('•')} ${item}`);
    }
  }
}

export const logger = new Logger();
export default logger;
