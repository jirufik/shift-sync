import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { DomainError } from '../../common/domain-error';
import { httpError } from '../../common/error-patterns';
import { AuthService, SESSION_COOKIE } from './auth.service';
import { IS_PUBLIC_KEY } from './public.decorator';

/** Глобальный страж: всё закрыто, кроме помеченного @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (!token) throw httpError(new DomainError('err.login-required'));

    this.auth.verify(token);
    return true;
  }
}
