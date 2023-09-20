import { ConsoleLogger, Logger } from '@nestjs/common';
import { createWriteStream, WriteStream } from 'fs';

// const options = {
//   timeZone: 'America/Chicago',
//   year: 'numeric',
//   month: '2-digit',
//   day: '2-digit',
//   hour: '2-digit',
//   minute: '2-digit',
//   second: '2-digit',
// };

// const dateFormatter = new Intl.DateTimeFormat('en-US', options);
// const timestamp = formatter.format(new Date());

export class MyLogger extends ConsoleLogger {
  private logStream: WriteStream;

  constructor(context?: string) {
    super(context);
    this.logStream = createWriteStream('error.log', { flags: 'a' });
  }

  setContext(context: string) {
    this.context = context;
  }

  logWithCSTDate(message) {
    // Create a Date object for the current time
    const date = new Date();
  
    // Convert to CST (UTC-6)
    const cstOffset = -6 * 60;
    const offset = date.getTimezoneOffset() - cstOffset;
    const cstDate = new Date(date.getTime() + offset * 60 * 1000);
  
    // Format the date/time string as desired
    const dateTimeString = cstDate.toISOString().replace('T', ' ').substring(0, 19);
  
    // Print the log with the date/time string
    return `[${dateTimeString} CST] ${message}`;
  }

  log(message: any) {
    // add date to log
    this.logStream.write(`LOG: ${this.logWithCSTDate(message)}\n`);
    //console.log(message)
    super.log(this.logWithCSTDate(message));
  }
  error(message: string, trace: string) {
    /* your implementation */
    this.logStream.write(`ERROR: ${this.logWithCSTDate(message)}\nTRACE: ${trace}\n`);
    //console.log(message)
    super.error(this.logWithCSTDate(message), trace);
  }
  warn(message: any) {
    /* your implementation */
    //console.log(message)
    super.warn(message);
  }
  debug(message: string) {
    /* your implementation */
    //console.log(message)
    super.debug(message);
  }
  verbose(message: string) {
    /* your implementation */
    //console.log(message)
    super.verbose(message);
  }


}