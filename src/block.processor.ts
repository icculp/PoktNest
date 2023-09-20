// block.processor.ts
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Block } from './entities/block.entity'; // Replace with your actual Block entity path
import { Transaction } from './entities/transaction.entity'; // Replace with your actual Transaction entity path

import { IndexerService } from './indexer.service';
import { MyLogger } from './my-logger.service';

@Processor('blockProcessing')
export class BlockProcessor {
  private readonly logger = new MyLogger(IndexerService.name)
  constructor(@InjectRepository(Block)
  private readonly blockRepository: Repository<Block>,
  @InjectRepository(Transaction)
  private readonly transactionRepository: Repository<Transaction>,
  private readonly indexerService: IndexerService
  ) {}

  @Process({name: 'processBlock', concurrency: 100})
  async processBlock (job: Job<number>): Promise<void> {
    const height = job.data
    const existsAndComplete = await this.indexerService.blockExistsAndComplete(height)
    // const indexerService = 
    if (!existsAndComplete) { // || this.verificationMode)
      this.logger.log(`Processing block height: ${height}`)
      const { block, transactions } = await this.indexerService.syncBlock(height);
      await this.blockRepository.save(block)
      await this.transactionRepository.save(transactions)
    } else {
      this.logger.log(`Block ${height} already exists ...`)
    }
    //}


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

  //}
  }
}