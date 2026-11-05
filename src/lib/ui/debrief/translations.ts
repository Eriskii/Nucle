import type { Lang } from '#lib/game/i18n.ts';
import { RU } from './text.ru.ts';
import { EN, type DebriefText } from './text.ts';

export const TEXT: Record<Lang, DebriefText> = { en: EN, ru: RU };
