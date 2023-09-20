import { MiddlewareConsumer, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppLoggerMiddleware } from './logger.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Block } from './entities/block.entity';
import { Transaction } from './entities/transaction.entity';
import { IndexerService } from './indexer.service';

require('dotenv').config();

@Module({
  imports: [TypeOrmModule.forRoot({
                                    type: 'postgres',
                                    host:  process.env.PG_HOST,
                                    port:  Number(process.env.PG_PORT),
                                    username:  process.env.PG_USER,
                                    password:  process.env.PG_PASSWORD,
                                    database:  process.env.PG_DATABASE,
                                    poolSize: 500,
                                    entities: [__dirname + '/**/*.entity{.ts,.js}'],
                                    synchronize: true,
                                  }),
            TypeOrmModule.forFeature([Block, Transaction]),
            ScheduleModule.forRoot()
          ],                                                  
  controllers: [],
  providers: [AppService, IndexerService],
})

export class AppModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AppLoggerMiddleware).forRoutes('*');
  }
}
