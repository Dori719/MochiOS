import { useTranslation } from 'react-i18next';
import { stickerName } from '../../../st/sticker-format';
import { mochiGeneratedPhoto } from '../../../st/generated-photo';
import { VOICE_WAVE_HEIGHTS } from './mochi-os.constants';
import {
  formatMochiTransferDisplay, isMochiTransferType, mochiTransferNote,
  mochiTransferOutcome, type ParsedMochiChatWidget,
} from './mochi-os.utils';

type WidgetMessage = ParsedMochiChatWidget['chat']['messages'][number];

/** Read-only transfer outcomes; answering remains in the phone conversation. */
function MochiWidgetTransferCard({ message, currency }: { message: WidgetMessage; currency: string }) {
  const { t } = useTranslation();
  const amount = formatMochiTransferDisplay(message.rawItem, currency);
  const note = mochiTransferNote(message.rawItem);
  const outcome = mochiTransferOutcome(message.type);
  const stampLabel = outcome
    ? outcome === 'accepted'
      ? t('ui.chat.mochiPrivateChat.transferAccepted')
      : t('ui.chat.mochiPrivateChat.transferRejected')
    : '';

  return (
    <div className={`mochi-private-transfer${outcome ? ` is-${outcome}` : ''}`}>
      <div className="mochi-private-transfer-legend">
        <span className="mochi-private-transfer-medallion" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <line x1="12" y1="3" x2="12" y2="21" />
            {message.me ? (
              <>
                <polyline points="6 9 12 3 18 9" />
                <polyline points="6 15 12 21 18 15" />
              </>
            ) : (
              <>
                <polyline points="18 9 12 15 6 9" />
                <polyline points="18 15 12 21 6 15" />
              </>
            )}
          </svg>
        </span>
        <span className="mochi-private-transfer-direction">
          {message.me ? t('ui.chat.mochiPrivateChat.transferSent') : t('ui.chat.mochiPrivateChat.transferReceived')}
        </span>
      </div>
      <div className="mochi-private-transfer-amount">
        {amount || t('ui.chat.mochiPrivateChat.transferAmountUnknown')}
      </div>
      {note && (
        <div className="mochi-private-transfer-memo">
          <span className="mochi-private-transfer-memo-label">{t('ui.chat.mochiPrivateChat.transferMemo')}</span>
          <span className="mochi-private-transfer-memo-text">{note}</span>
        </div>
      )}
      {outcome && (
        <div className="mochi-private-transfer-stamp" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            {outcome === 'accepted' ? <polyline points="20 6 9 17 4 12" /> : (
              <>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </>
            )}
          </svg>
          <span>{stampLabel}</span>
        </div>
      )}
    </div>
  );
}

/** Private and group widgets render every type through the same bubble body. */
export function MochiWidgetMessageBubble({ message, currency, stickerMap }: {
  message: WidgetMessage; currency: string; stickerMap: Map<string, string>;
}) {
  const { t } = useTranslation();
  const photo = mochiGeneratedPhoto(message.rawItem);
  if (photo) return <div className="mochi-private-bubble"><img src={photo} alt={String(message.rawItem?.c || 'Generated photo')} style={{ display: 'block', maxWidth: '100%', maxHeight: 360, borderRadius: 12 }} /></div>;
  if (isMochiTransferType(message.type)) return <MochiWidgetTransferCard message={message} currency={currency} />;
  if (message.type === 'voice') return (
    <div className="mochi-private-bubble voice" aria-label={`${t('ui.chat.mochiosview.voiceNote')}: ${message.text || message.dur || '0:05'}`}>
      <span className="play" aria-hidden="true"><svg viewBox="0 0 12 14"><path d="M0 0l12 7-12 7z" /></svg></span>
      <span className="wave" aria-hidden="true">
        {VOICE_WAVE_HEIGHTS.map((height, index) => <i key={index} style={{ height: `${height}px` }} />)}
      </span>
      <time>{message.dur || '0:05'}</time>
    </div>
  );

  const quote = message.type === 'quote' ? message.rawItem?.quote : undefined;
  const quoteText = typeof quote === 'string' ? quote : String(quote?.c || quote?.content || '');
  const quotedSticker = stickerMap.get(stickerName(quoteText));
  const sentSticker = message.type === 'sticker' ? stickerMap.get(stickerName(message.text)) : undefined;
  return (
    <div className={`mochi-private-bubble${quote ? ' is-quote' : ''}${message.type !== 'sticker' ? ' mochi-text-bubble' : ''}`}>
      {quote && (
        <div className="mochi-private-quoted-message">
          {typeof quote === 'object' && quote.name && <strong>{String(quote.name)}</strong>}
          {quotedSticker ? <img className="mochi-private-sticker" src={quotedSticker} alt="" /> : (
            <span>{quoteText || t('ui.chat.mochiGroupChat.quote')}</span>
          )}
        </div>
      )}
      <div>{sentSticker ? <img className="mochi-private-sticker" src={sentSticker} alt={message.text} /> : message.text}</div>
    </div>
  );
}
