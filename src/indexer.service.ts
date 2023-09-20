/* eslint-disable @typescript-eslint/return-await */
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { type FindOneOptions, Repository } from 'typeorm'
import axios from 'axios'
import { Block } from './entities/block.entity'
import { Transaction } from './entities/transaction.entity'
import { Cron, CronExpression, SchedulerRegistry } from '@nestjs/schedule'
import { MyLogger } from './my-logger.service'
import * as retry from 'async-retry'


// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config();
const POKT_URL = process.env.POKT_URL
// const POKT_USER = process.env.POKT_USER || 'pocket'
// const POKT_PASSWORD = process.env.POKT_PASSWORD || 'pocket'
const BACKOFF = 1.1

@Injectable()
export class IndexerService {
  private readonly logger = new MyLogger(IndexerService.name)
  private verificationMode: boolean = false
  // private blockProcessingQueue: Queue;
  // schedulerRegistry: any;

  constructor (
    @InjectRepository(Block)
    private readonly blockRepository: Repository<Block>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    private readonly schedulerRegistry: SchedulerRegistry,
    @InjectQueue('blockProcessing') private blockQueue: Queue
  ) {
    // this.blockProcessingQueue = new Queue('blockProcessing');
  }

  async getHeight () {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    }
    const data = { }
    const numberOfRetries = 20
    return await retry(async (bail, numberOfRetries) => {
      try {
        const response = await axios.post(POKT_URL + '/v1/query/height', data, { headers })
        const height = response.data.height
        console.log(height)
        return height
      } catch (error) {
        console.error('Error:', error)
        if (error.status === 400) { // or any other criteria to bail out early
          // don't retry upon specific condition
          bail(new Error('Do not retry on bad request'))
          return
        }
        throw error // throw error so `retry` knows it should retry
      }
    }, {
      retries: numberOfRetries, // number of retries
      minTimeout: 1000, // starting timeout in ms
      factor: BACKOFF // exponential backoff factor
    })
  }

  async getBlock (height: number) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    }
    const data = { height }

    return await retry(async (bail, numberOfRetries) => {
      try {
        const response = await axios.post(POKT_URL + '/v1/query/block', data, { headers })
        const block = response.data.block
        // console.log(block);
        return block
      } catch (error) {
        console.error('Error:', error)
        if (error.status === 400) { // or any other criteria to bail out early
          // don't retry upon specific conditions
          bail(new Error('Do not retry on bad request'))
          return
        }
        throw error // throw error so `retry` knows it should retry
      }
    }, {
      retries: 5, // number of retries
      minTimeout: 1000, // starting timeout in ms
      factor: BACKOFF // exponential backoff factor
    })
  }

  async getTx (hash: string) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    }
    const data = { hash, prove: true }
    await axios.post(POKT_URL + '/v1/query/tx', data, { headers })
      .then(response => {

      })
      .catch(error => {
        console.error('Error:', error)
      }
      )
  }

  async getBlockTransactions (height: number, page: number, per_page: number = 1000, order: string = 'desc'): Promise<any> {
    return await retry(async (bail, numberOfRetries) => {
      try {
        const response = await axios.post(`${POKT_URL}/v1/query/blocktxs`, {
          height,
          page,
          per_page,
          sort: order
        })

        if (response.status === 200) {
          return response.data
        } else {
          throw new Error(`Reply status_code: ${response.status} != 200`)
        }
      } catch (error) {
        this.logger.warn(`Failed to getBlockTransactions: ${error.message}`)
        throw error // throw error so `retry` knows it should retry
      }
    }, {
      retries: 10,
      minTimeout: 3000, // starting timeout in ms
      factor: BACKOFF // exponential backoff factor
    })
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  async getBlockTxs (height: number, retries: number = 20, per_page: number = 1000): Promise<any[]> {
    let page = 1
    let txs: any[] = []

    while (retries > 0) {
      try {
        const blockTxs = await this.getBlockTransactions(height, page, per_page)

        if ((Boolean(blockTxs.txs)) && blockTxs.txs.length === 0) {
          return txs
        } else {
          txs = [...txs, ...blockTxs.txs]
          page += 1
        }
      } catch (error) {
        this.logger.warn(`Failed to getBlockTxs for height: ${height}. Error: ${error.message}`)
        retries -= 1

        if (retries <= 0) {
          throw new Error(`Out of retries getting block ${height} transactions on page ${page}`)
        }
      }
    }

    throw new Error('getBlockTxs failed.')
  }
  // }

  async blockExistsAndComplete (height: number): Promise<boolean> {
    // const options: FindOneOptions = {}
    const block = await this.blockRepository.findOneBy({ height })

    if (block !== null) {
      // Check if the block data is complete.
      // This is a basic check; adjust based on your specific needs.
      if (block.proposer !== null && block.relays !== null && block.txs !== null) {
        return true
      }
    }
    return false
  }

  private flattenTx (tx: any, RelaysToTokensMultiplier: number, timestamp: string): any {
    let sessionBlockHeight = null
    let servicerPubKey = ''
    let amount = 0
    let appPubKey = ''
    let chain = ''
    let totalProofs = null
    const messageType = tx.tx_result.message_type

    switch (messageType) {
      case 'send':
        amount = tx.stdTx.msg.value.amount
        break
      case 'claim':
        appPubKey = tx.stdTx.msg.value.header.app_public_key
        chain = tx.stdTx.msg.value.header.chain
        sessionBlockHeight = tx.stdTx.msg.value.header.session_height
        totalProofs = parseInt(tx.stdTx.msg.value.total_proofs)
        amount = totalProofs * RelaysToTokensMultiplier
        break
      case 'proof':
        appPubKey = tx.stdTx.msg.value.leaf.value.aat.app_pub_key
        chain = tx.stdTx.msg.value.leaf.value.blockchain
        servicerPubKey = tx.stdTx.msg.value.leaf.value.servicer_pub_key
        sessionBlockHeight = tx.stdTx.msg.value.leaf.value.session_block_height
        break
      case 'stake_validator':
        amount = tx.stdTx.msg.value.value
        servicerPubKey = tx.stdTx.msg.value.public_key.value
        break
      case 'unjail_validator':
      case 'begin_unstake_validator':
        servicerPubKey = tx.stdTx.signature.pub_key
        break
      default:
        console.log(`Not known message_type: ${messageType} hash: ${tx.hash}`)
    }

    const fee = (tx.stdTx.fee.length === 0) ? 0 : tx.stdTx.fee[0].amount

    return {
      height: tx.height,
      hash: tx.hash,
      index: tx.index,
      resultCode: tx.tx_result.code,
      appPubKey,
      chain,
      servicerPubKey,
      signer: tx.tx_result.signer,
      recipient: tx.tx_result.recipient,
      msgType: messageType,
      totalProofs,
      fee,
      memo: tx.stdTx.memo,
      amount,
      timestamp
    }
  }

  async syncBlock(height: number, txConcurrencyLimit: number = 10): Promise<{ block: Block, transactions: any[] } | null> {
    try {
      // Fetch block and relays-to-tokens multiplier
      const block = await this.getBlock(height)
      const RelaysToTokensMultiplier = await this.getRelaysToTokensMultiplier(height)
      const timestamp = block.header.time
      const proposer = block.header.proposer_address

      // Fetch all block transactions
      const blockTxs = await this.getBlockTxs(height)
      // this.logger.log(`Number of transactions in block: ${height} is ${blockTxs.length}`)

      //
      const flatTxs = blockTxs.map(tx => this.flattenTx(tx, RelaysToTokensMultiplier, timestamp))
      const totalRelays = flatTxs.reduce((acc, data) => acc + data.totalProofs, 0)

      // Save all transactions to the database
      // const allFlattenedTxs = flatTxs.map(data => data.flattenedTx);
      // await this.transactionRepository.save(flatTxs, { chunk: 4000 })

      // // Divide transactions into chunks
      // const txChunkSize = txConcurrencyLimit; //100; // Adjust based on what you find optimal
      // const txChunks = [];
      // for (let i = 0; i < blockTxs.length; i += txChunkSize) {
      //     txChunks.push(blockTxs.slice(i, i + txChunkSize));
      // }

      // let allProcessedTxs = [];
      // for (const txChunk of txChunks) {
      //     const processedTxsChunk = await Promise.all(txChunk.map(async tx => {
      //         const flattenedTx = this.flattenTx(tx, RelaysToTokensMultiplier, timestamp);
      //         //const relays = this.countRelays(flattenedTx); // Adjust this method as needed

      //         return {
      //             flattenedTx: flattenedTx,
      //             relays: flattenedTx.totalProofs || 0
      //         };
      //     }));
      //     allProcessedTxs = [...allProcessedTxs, ...processedTxsChunk];
      // }

      // // Count total relays
      // const totalRelays = allProcessedTxs.reduce((acc, data) => acc + data.relays, 0);

      // // Save all transactions to the database
      // const allFlattenedTxs = allProcessedTxs.map(data => data.flattenedTx);
      // await this.transactionRepository.save(allFlattenedTxs, {chunk: 500});

      // Save block with total relays (and other necessary data)
      const blockEntity = new Block()
      blockEntity.height = height
      blockEntity.timestamp = timestamp // new Date(timestamp)
      blockEntity.txs = flatTxs.length
      blockEntity.proposer = proposer
      blockEntity.relays = totalRelays
      //           console.log('relays: ', relays)
      // blockEntity.txs = allFlattenedTxs.length;

      // this.logger.log(`Saving block to db, block: ${height}, blockEntity: ${blockEntity.height}, ${blockEntity.proposer}, ${blockEntity.relays}, ${'blockEntity.txs'}, ${blockEntity.timestamp}`)

      blockEntity.relays = totalRelays
      // await this.blockRepository.save(blockEntity, { chunk: 100 })

      return {
        block: blockEntity,
        transactions: flatTxs
      }
    } catch (error) {
      this.logger.warn(`Exception in syncBlock at height ${height}, error: ${error.message}`)
      return null
    }
  }

  // async syncBlock(height: number, retries: number = 10): Promise<boolean> {
  //   while (retries > 0) {
  //       try {
  //           // Assuming you have a method to get RelaysToTokensMultiplier
  //           const RelaysToTokensMultiplier = await this.getRelaysToTokensMultiplier(height);

  //           const block = await this.getBlock(height);
  //           const timestamp = block.header.time;
  //           const proposer = block.header.proposer_address;

  //           console.log(`Start gathering transactions for block: ${height}`);
  //           const blockTxs = await this.getBlockTxs(height);

  //           console.log(`Flattening transactions for block: ${height}`);
  //           const flatTxs = blockTxs.map(tx => this.flattenTx(tx, RelaysToTokensMultiplier, timestamp));

  //           console.log(`Counting relays in block: ${height}`);
  //           let relays = 0;
  //           for (const t of flatTxs) {
  //               if (t.msg_type === "claim") {
  //                   relays += parseInt(t.total_proofs, 10);
  //               }
  //           }

  //           console.log(`Saving transactions to db, block: ${height}`);
  //           await this.transactionRepository.save(flatTxs);
  //           console.log(`Saving block to db, block: ${height}`);
  //           const blockEntity = new Block();
  //           blockEntity.height = height;
  //           console.log('height: ', height)
  //           blockEntity.proposer = proposer;
  //           blockEntity.relays = relays;
  //           console.log('relays: ', relays)
  //           blockEntity.txs = flatTxs.length;
  //           console.log('flatTxs.length: ', flatTxs.length)
  //           blockEntity.timestamp = new Date(timestamp); // Assuming timestamp is a string. Adjust if needed.
  //           this.logger.log(`Saving block to db, block: ${height}, blockEntity: ${blockEntity.height}, ${blockEntity.proposer}, ${blockEntity.relays}, ${blockEntity.txs}, ${blockEntity.timestamp}`);
  //           await this.blockRepository.save(blockEntity);

  //           return true;
  //       } catch (error) {
  //           console.warn(`Exception in syncBlock: ${error.message}`);
  //           retries -= 1;
  //           await this.sleep(Math.floor(Math.random() * 6) + 5); // sleep between 5 to 10 seconds
  //       }
  //   }
  //   return false;
  // }

  private async sleep (ms: number) {
    return await new Promise(resolve => setTimeout(resolve, ms))
  }

  async getRelaysToTokensMultiplier (height: number): Promise<number> {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    }
    const data = { height, key: 'pos/RelaysToTokensMultiplier' }

    return await retry(async (bail, numberOfRetries) => {
      try {
        const response = await axios.post(`${POKT_URL}/v1/query/param`, data, { headers })
        if (response.status === 200 && (Boolean(response.data))) {
          return response.data.param_value // Assuming the API returns it in this format
        } else {
          throw new Error(`Reply status_code: ${response.status} != 200`)
        }
      } catch (error) {
        this.logger.warn(`Failed to getRelaysToTokensMultiplier: ${error.message}`)
        throw error // throw error so `retry` knows it should retry
      }
    }, {
      retries: 10,
      minTimeout: 1000, // starting timeout in ms
      factor: BACKOFF // exponential backoff factor
    })
  }

  async processBlocksConcurrently(start: number, end: number, concurrency: number): Promise<void> {
    // start at 0 and work up
    // const heights = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    // start at latest and work backwards
    const heights = Array.from({ length: end - start + 1 }, (_, i) => end - i)

    // for (const height of heights) {
    //   await this.blockQueue.add('processBlock', height);
    // }

    const chunks = []
    concurrency = 30 // set to 1 to disable concurrency
    for (let i = 0; i < heights.length; i += concurrency) {
      chunks.push(heights.slice(i, i + concurrency))
    }

    // const allBlocks: Block[] = []
    // const allTransactions: any[] = []
    for (const chunk of chunks) {
      // this.logger.log(`Processing block heights: ${chunk[0]} to ${chunk[chunk.length - 1]}`)

      await Promise.allSettled(chunk.map(async height => {
        await this.blockQueue.add('processBlock', height);
      }));
    }
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
    //   await this.blockRepository.save(allBlocks, { chunk: 100 })
    // }
    // if (allTransactions.length > 0) {
    //   await this.transactionRepository.save(allTransactions, { chunk: 4000 })
    // }
  }
  // }

  // async processTransactionsConcurrently(blockTxs: any[]) {
  //     const txConcurrencyLimit = 10;  // Adjust as needed

  //     const txChunks = [];
  //     for (let i = 0; i < blockTxs.length; i += txConcurrencyLimit) {
  //         txChunks.push(blockTxs.slice(i, i + txConcurrencyLimit));
  //     }

  //     for (const txChunk of txChunks) {
  //         this.logger.log(`Processing transactions : ${txChunk[0]} to ${txChunk[txChunk.length - 1]}`);
  //         await Promise.all(txChunk.map(tx => {
  //             // Whatever processing you do per transaction
  //             // For instance, if you save each transaction to the database
  //             return this.transactionRepository.save(tx);
  //         }));
  //     }
  // }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, {
    name: 'verification_trigger'
  })
  triggerVerificationMode () {
    this.verificationMode = true
  }

  @Cron(CronExpression.EVERY_10_SECONDS, {
    name: 'indexer_tasks'
  })
  async indexBlockchainData () {
    const job = this.schedulerRegistry.getCronJob('indexer_tasks')
    job.stop()
    this.verificationMode = false
    // add creds to axios post
    // axios.defaults.headers.common['Authorization'] = `Basic ${Buffer.from(CREDS).toString('base64')}`;
    const height = await this.getHeight()

    // const useConcurrency = true; // Set this to false if you don't want concurrency
    const firstLevelConcurrencyLimit: number = 200 // Number of blocks to process concurrently, set to 0 to disable as transactions can run concurrently and multiple levels might be too much

    if (firstLevelConcurrencyLimit !== 0) {
      await this.processBlocksConcurrently(0, height, firstLevelConcurrencyLimit)
    } else {
      let currentHeight = height
      while (currentHeight > 0) {
        const existsAndComplete = await this.blockExistsAndComplete(currentHeight)
        if (!existsAndComplete || this.verificationMode) {
          await this.syncBlock(currentHeight)
        } else {
          this.logger.log(`Block ${currentHeight} already exists ...`) // and is complete`);
        }
        currentHeight--
      }
    }
    this.verificationMode = false
    job.start()

    // let data = {};
    // let height = await this.getHeight()
    // //let height = heightResponse.data.result;
    // this.logger.log(`Current height: ${height} url: ${POKT_URL}`)
    // //0; // You might want to dynamically fetch the last indexed height
    // while (height > 0) {
    //     const blockExistsAndComplete = await this.blockExistsAndComplete(height);
    //     if (!blockExistsAndComplete) {
    //         await this.syncBlock(height);
    //     }
    //   //let data2 = {height: height}
    //   this.logger.log(`313 height: ${height} `)
    //   height = height - 1;

    // }
  }
}
