import { Entity, Column, PrimaryColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { timestampType, timestampDefault } from '../common/utils/sql-dialect';
import { Agent } from './agent.entity';

export interface CustomProviderModel {
  model_name: string;
  input_price_per_million_tokens?: number;
  output_price_per_million_tokens?: number;
  context_window?: number;
  supports_response_api?: boolean;
}

export interface ResponseAPIConfig {
  audio?: {
    input?: boolean;
    output?: boolean;
    format?: 'mp3' | 'wav' | 'pcm16';
  };
  screen?: {
    capture?: boolean;
    analysis?: boolean;
  };
  streaming?: boolean;
}

@Entity('custom_providers')
@Index(['agent_id', 'name'], { unique: true })
export class CustomProvider {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar')
  agent_id!: string;

  @Column('varchar')
  user_id!: string;

  @Column('varchar')
  name!: string;

  @Column('varchar')
  base_url!: string;

  @Column('varchar', { nullable: true, default: null })
  path_suffix!: string | null;

  @Column('simple-json')
  models!: CustomProviderModel[];

  @Column('boolean', { default: false })
  enable_response_api!: boolean;

  @Column('simple-json', { nullable: true })
  response_api_config!: ResponseAPIConfig | null;

  @ManyToOne(() => Agent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agent_id' })
  agent!: Agent;

  @Column(timestampType(), { default: timestampDefault() })
  created_at!: string;
}
