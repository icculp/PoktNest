// block.processor.ts
import { Processor, Process, InjectQueue } from '@nestjs/bull';
import { Job } from 'bull';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Block } from './entities/block.entity';
import { Transaction } from './entities/transaction.entity';
import { IndexerService } from './indexer.service';
import { MyLogger } from './my-logger.service';
import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bull';

@Injectable()
export class BufferService implements OnModuleInit {
  private blocks: Block[] = [];
  private transactions: Transaction[] = [];
  private isFlushingBlocks = false;
  private isFlushingTransactions = false;
  private isFlushBlocksQueued = false;
  private isFlushTransactionsQueued = false;
  private readonly logger = new MyLogger(BufferService.name);

  constructor(
    @InjectRepository(Block)
    private readonly blockRepository: Repository<Block>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    @InjectQueue('flushBlocksQueue') private readonly flushBlocksQueue: Queue,
    @InjectQueue('flushTransactionsQueue') private readonly flushTransactionsQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await Promise.all([
      this.flushTransactionsQueue.process('flushTransactions', 5, this.flushTransactions.bind(this)),
      this.flushBlocksQueue.process('flushBlocks', 5, this.flushBlocks.bind(this))
    ]); 
  }

  addBlock(block: Block): void {
    this.blocks.push(block);
  }

  addTransactions(transactions: Transaction[]): void {
    this.transactions.push(...transactions);
  }

  get blocksCount(): number {
    return this.blocks.length;
  }

  get transactionsCount(): number {
    return this.transactions.length;
  }

  async flushBlocks(job: Job): Promise<void> {
    if (this.isFlushingBlocks) {
      this.logger.error(`Already flushing blocks, blocks: ${this.blocks.length}`, '')
      return;
    }
    this.isFlushingBlocks = true;
    const tempBlocks = [...this.blocks];
    this.blocks = [];
    try {
      if (tempBlocks.length > 0) {
        this.logger.log(`Saving blocks, blocks: ${tempBlocks.length}`)
        await this.blockRepository.save(tempBlocks, { chunk: 1000 });
      }
    } catch (error) {
      console.log(error);
    }
    this.isFlushingBlocks = false;
    this.isFlushBlocksQueued = false;
  }

  async flushTransactions(job: Job): Promise<void> {
    if (this.isFlushingTransactions) {
      this.logger.log(`Already flushing transactions, transactions: ${this.transactions.length}`)
      return;
    }
    // this.logger.error(`we've finally entered flushing transactions`, '')
    this.isFlushingTransactions = true;
    const tempTransactions = [...this.transactions];
    this.transactions = [];
    try {
      if (tempTransactions.length > 0) {
        this.logger.log(`Saving transactions, transactions: ${tempTransactions.length}`)
        await this.transactionRepository.save(tempTransactions, { chunk: 3000 });
      }
    } catch (error) {
      console.log(error);
    }
    this.isFlushingTransactions = false;
    this.isFlushTransactionsQueued = false;
  }

  async queueFlushBlocks(): Promise<void> {
    if (!this.isFlushBlocksQueued) {
      this.isFlushBlocksQueued = true;
      await this.flushBlocksQueue.add('flushBlocks', {});
    } else {
      this.logger.log(`Already queued flushing blocks, blocks: ${this.blocks.length}`)
    }
  }

  async queueFlushTransactions(): Promise<void> {
    if (!this.isFlushTransactionsQueued) {
      this.isFlushTransactionsQueued = true;
      await this.flushTransactionsQueue.add('flushTransactions', {});
    } else {
      this.logger.log(`Already queued flushing transactions, transactions: ${this.transactions.length}`)
    }
  }
}

@Injectable()
@Processor('blockProcessing')
export class BlockProcessor {
  private readonly logger = new MyLogger(BlockProcessor.name);

  constructor(
    @InjectRepository(Block)
    private readonly blockRepository: Repository<Block>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    private readonly indexerService: IndexerService,
    private readonly bufferService: BufferService,
  ) {}

  @Process({ name: 'processBlock', concurrency: 10 })
  async processBlock(job: Job<number>): Promise<void> {
    const height = job.data;
    const existsAndComplete = await this.indexerService.blockExistsAndComplete(height);

    if (!existsAndComplete) {
      const { block, transactions } = await this.indexerService.syncBlock(height);
      this.bufferService.addBlock(block);
      this.bufferService.addTransactions(transactions);
      this.logger.log(`Block ${height} added to buffer, blocks: ${this.bufferService.blocksCount}, transactions: ${this.bufferService.transactionsCount}`);
    }

    if (this.bufferService.blocksCount >= 30) {
      this.logger.log(`Sending blocks to flush queue, blocks: ${this.bufferService.blocksCount}`)
      await this.bufferService.queueFlushBlocks();
    }

    if (this.bufferService.transactionsCount >= 100000) {
      this.logger.log(`Sending transactions to flush queue, transactions: ${this.bufferService.transactionsCount}`)
      // show queue length
      await this.bufferService.queueFlushTransactions();
    }
  }
}

// const allBlocks: Block[] = []
// const allTransactions: any[] = []
// for (const chunk of chunks) {
//   this.logger.log(`Processing block heights: ${chunk[0]} to ${chunk[chunk.length - 1]}`)

//   const processedData = await Promise.allSettled(chunk.map(async height => {
//     const existsAndComplete = await this.blockExistsAndComplete(height)
//     if (!existsAndComplete || this.verificationMode) {
//       return await this.syncBlock(height)
//     } else {
//       this.logger.log(`Block ${height} already exists ...`)
//       return null
//     }
//   }))

//   // Filter out null results
//   const validData = processedData
//     .filter(data => data.status === 'fulfilled' && data.value !== null)
//     .map(data => (data as PromiseFulfilledResult<any>).value)

//   // Add to allBlocks and allTransactions
//   allBlocks.push(...validData.map(data => data.block))
//   allTransactions.push(...[].concat(...validData.map(data => data.transactions)))
//   this.logger.log(`blocks: ${allBlocks.length}, transactions: ${allTransactions.length}`)
//   // Save if transactions count exceed a certain limit or at the end of each chunk
//   //
//   if (allTransactions.length >= 100000) {
//     this.logger.log(`Saving blocks and transactions, blocks: ${allBlocks.length}, transactions: ${allTransactions.length}`)
//     await this.blockRepository.save(allBlocks, { chunk: 100 })
//     await this.transactionRepository.save(allTransactions, { chunk: 500 })

//     // Clear saved blocks and transactions
//     allBlocks.length = 0
//     allTransactions.length = 0
//   }
// }

// // Save any remaining blocks and transactions after loop completes
// if (allBlocks.length > 0) {
//   , { chunk: 100 })
// }
// if (allTransactions.length > 0) {
//   await this.transactionRepository.save(allTransactions, { chunk: 4000 })
// }

// }
//   }
// }