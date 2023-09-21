import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn
} from 'typeorm';

@Entity('block')
export class Block {
  @PrimaryGeneratedColumn()
    id: number;

  @Column('int')
    height: number;

  @Column('text')
    proposer: string;

  @Column('int')
    relays: number;

  @Column('int')
    txs: number;

  @CreateDateColumn()
    timestamp: Date;
}
