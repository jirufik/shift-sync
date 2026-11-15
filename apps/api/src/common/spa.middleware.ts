import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Раздача собранного фронта тем же процессом (D-011).
 *
 * Всё, что не `/api` и не `/health`, сначала ищется среди статических файлов,
 * а если файла нет — отдаётся оболочка SPA. Последнее обязательно:
 * маршрутизация живёт на клиенте, поэтому у прямой ссылки вида
 * `/imports/<uuid>` нет файла на диске, и без фолбэка обновление страницы
 * возвращало бы 404.
 *
 * Оболочка читается в память один раз при старте: она весит пару килобайт,
 * а `res.sendFile` в Express 5 при ошибке уводит запрос в общий обработчик,
 * из-за чего фолбэк молча превращался в 404 от Nest.
 */
export function createSpaMiddleware(webRoot: string) {
  const indexFile = join(webRoot, 'index.html');
  if (!existsSync(webRoot) || !existsSync(indexFile)) return null;

  const shell = readFileSync(indexFile);

  const serveFiles = express.static(webRoot, {
    index: false,
    fallthrough: true,
    redirect: false,
    setHeaders: (res, path) => {
      // содержимое /_nuxt адресуется хешем — можно кэшировать навсегда
      res.setHeader(
        'Cache-Control',
        path.includes('/_nuxt/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
      );
    },
  });

  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api') || req.path === '/health') return next();

    serveFiles(req, res, () => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.status(200).end(shell);
    });
  };
}
