import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, timingSafeEqual } from 'node:crypto';

import { DomainError } from '../../common/domain-error';
import { httpError } from '../../common/error-patterns';
import { AppConfigService } from '../../config/app-config.service';

export interface SessionPayload {
  sub: 'owner';
  iat?: number;
  exp?: number;
}

export const SESSION_COOKIE = 'fc_session';

@Injectable()
export class AuthService {
  constructor(
    private readonly cfg: AppConfigService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Сравнение через хеши фиксированной длины: timingSafeEqual падает на строках
   * разной длины, а сама длина пароля — уже утечка. Хешируем оба и сравниваем дайджесты.
   */
  private matches(candidate: string): boolean {
    const expected = createHash('sha256').update(this.cfg.get('APP_PASSWORD'), 'utf8').digest();
    const actual = createHash('sha256').update(candidate, 'utf8').digest();
    return timingSafeEqual(expected, actual);
  }

  login(password: string): { token: string; maxAgeMs: number } {
    if (!this.matches(password)) {
      throw httpError(new DomainError('err.bad-password'));
    }
    const days = this.cfg.get('SESSION_TTL_DAYS');
    const token = this.jwt.sign({ sub: 'owner' } satisfies SessionPayload, {
      expiresIn: `${days}d`,
    });
    return { token, maxAgeMs: days * 24 * 60 * 60 * 1000 };
  }

  verify(token: string): SessionPayload {
    try {
      return this.jwt.verify<SessionPayload>(token);
    } catch {
      throw httpError(new DomainError('err.session-invalid'));
    }
  }

  get cookieOptions(): {
    httpOnly: true;
    sameSite: 'lax';
    secure: boolean;
    path: string;
  } {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.cfg.get('COOKIE_SECURE'),
      path: '/',
    };
  }
}
