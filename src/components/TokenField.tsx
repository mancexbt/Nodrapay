import { NETWORK_NAME } from '@/lib/network'
import { Field } from '@/components/ui'
import type { TokenMeta } from '@/hooks/useVaultData'
import { USDC_ADDRESS, fmtToken, sameAddr } from '@/lib/vault'

/** Token picker: USDC shortcut plus any ERC-20 address, with a live check that it is a token. */
export function TokenField({
  value,
  onChange,
  meta,
  label,
  hint,
  required,
}: {
  value: string
  onChange: (v: string) => void
  meta: TokenMeta
  label: string
  hint?: string
  required: boolean
}) {
  const isUsdc = sameAddr(value, USDC_ADDRESS)
  return (
    <Field label={label} hint={hint}>
      <div className="space-y-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onChange(USDC_ADDRESS)}
            className={`btn btn-sm shrink-0 ${isUsdc ? 'btn-primary' : 'btn-ghost'}`}
            aria-pressed={isUsdc}
          >
            USDC
          </button>
          {isUsdc ? (
            <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => onChange('')}>
              Other token
            </button>
          ) : (
            <input
              className="field mono"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={required ? '0x... token address' : 'Paste a token address'}
              spellCheck={false}
            />
          )}
        </div>
        {value.trim() !== '' && (
          <p className="text-xs tabular-nums" style={{ color: meta.valid && !meta.loading && !meta.ok ? 'var(--danger)' : 'var(--muted)' }}>
            {!meta.valid
              ? 'That is not a valid address.'
              : meta.loading
                ? 'Checking token...'
                : !meta.ok
                  ? `This address is not an ERC-20 token on ${NETWORK_NAME}.`
                  : `${meta.symbol} · ${meta.decimals} decimals${meta.balance !== undefined ? ` · you hold ${fmtToken(meta.balance, meta.decimals)}` : ''}`}
          </p>
        )}
      </div>
    </Field>
  )
}
