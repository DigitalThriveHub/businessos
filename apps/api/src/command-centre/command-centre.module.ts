import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { CommandCentreController } from './command-centre.controller';
import { CommandCentreService } from './command-centre.service';

@Module({
  imports: [DatabaseModule],
  controllers: [CommandCentreController],
  providers: [CommandCentreService],
})
export class CommandCentreModule {}
