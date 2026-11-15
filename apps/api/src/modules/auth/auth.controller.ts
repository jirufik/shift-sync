import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

import { AuthService, SESSION_COOKIE } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Подбор пароля ограничен пятью попытками за 15 минут. */
  @Public()
  @Throttle({ login: { ttl: 15 * 60_000, limit: 5 } })
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response): { ok: true } {
    const { token, maxAgeMs } = this.auth.login(dto.password);
    res.cookie(SESSION_COOKIE, token, { ...this.auth.cookieOptions, maxAge: maxAgeMs });
    return { ok: true };
  }

  @HttpCode(200)
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response): { ok: true } {
    res.clearCookie(SESSION_COOKIE, this.auth.cookieOptions);
    return { ok: true };
  }

  /** Проверка живости сессии — фронт зовёт при загрузке. */
  @HttpCode(200)
  @Post('me')
  me(): { ok: true } {
    return { ok: true };
  }
}
