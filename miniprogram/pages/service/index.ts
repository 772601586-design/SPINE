import { requireSession } from '../../services/session';
Page({ data: {}, onShow() { void requireSession(); } });
