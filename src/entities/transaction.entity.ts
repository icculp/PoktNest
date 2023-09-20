import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn
} from 'typeorm';

@Entity('transaction')
export class Transaction {
  @PrimaryGeneratedColumn()
  id: number;

  @Column('int')
  height: number;

  @Column('text')
  hash: string;

  @Column('int')
  index: number;

  @Column('int')
  resultCode: number;

  @Column('text')
  appPubKey: string;

  @Column('text')
  chain: string;

  @Column('text')
  servicerPubKey: string;

  @Column('text')
  signer: string;

  @Column('text')
  recipient: string;

  @Column('text')
  msgType: string;

  @Column('int', { nullable: true })
  totalProofs?: number;

  @Column('int')
  fee: number;

  @Column('text')
  memo: string;

  @Column('bigint')
  amount: number;

  @CreateDateColumn()
  timestamp: Date;
}
