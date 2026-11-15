import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'fc:isPublic';

/** Снимает глобальный AuthGuard с эндпоинта. Только для логина и health. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
