import 'reflect-metadata';
import { Module, Logger } from '@nestjs/common';
import { NestFactory, APP_GUARD, APP_FILTER } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppExceptionFilter, Db, config, httpMiddleware } from './common/infra';
import { AuthGuard, loadKeys } from './common/auth';
import { AuthController, IdentityService, UsersController } from './identity/identity';
import { DevOutboxController, Notifications } from './notification/notification';
import { CatalogController, EntitlementService } from './catalog/catalog';
import { EngineService } from './engine/engine.service';
import { EngineController, EngineSweeper } from './engine/engine.controller';
import { ScoringService } from './scoring/scoring.service';
import { QuestionsController } from './content/questions';
import { ExamsAdminController, SeriesAdminController } from './content/exams';
import { Settings, SettingsController } from './common/settings';
import { PerformanceIntelligence, PerformanceIntelligenceController } from './pi/performance-intelligence';
import { ReferralController, ReferralService } from './growth/referral';
import { Commerce, CommerceController, PackagesAdminController } from './growth/commerce';
import { TargetsAdminController, TargetsController } from './growth/targets';
import { GuidesAdminController, PlannerController, StudyPlanner } from './growth/planner';

@Module({
  controllers: [AuthController, UsersController, DevOutboxController, CatalogController, EngineController, QuestionsController, ExamsAdminController,
    SeriesAdminController, SettingsController, PerformanceIntelligenceController,
    ReferralController, CommerceController, PackagesAdminController, TargetsController, TargetsAdminController, PlannerController, GuidesAdminController],
  providers: [
    Db, Settings, StudyPlanner, PerformanceIntelligence, ReferralService, Commerce, Notifications, IdentityService, EntitlementService, ScoringService, EngineService, EngineSweeper,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AppExceptionFilter },
  ],
})
class AppModule {}

async function bootstrap() {
  await loadKeys();
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.use(httpMiddleware);
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: config.webOrigin, credentials: true });
  app.enableShutdownHooks();
  (app.getHttpAdapter().getInstance() as any).set('trust proxy', 'loopback');
  await app.listen(config.port);
  new Logger('API').log(`Cogniverse API berjalan di http://localhost:${config.port}/api/v1`);
}
bootstrap();
