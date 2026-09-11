import { Router } from 'express';
import { healthRouter } from './health.routes';

export const routes = Router();

routes.use('/health', healthRouter);
