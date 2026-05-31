// EMV BR Code (PIX) static payload generator

function emvField(tag, value) {
  const len = value.length.toString().padStart(2, '0')
  return `${tag.toString().padStart(2, '0')}${len}${value}`
}

function crc16(s) {
  let crc = 0xFFFF
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1)
      crc &= 0xFFFF
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

export function buildPixPayload({ key, amount, merchant, city, txid = '***' }) {
  const gui = emvField('00', 'br.gov.bcb.pix')
  const pixKey = emvField('01', key)
  const merchAcc = emvField('26', gui + pixKey)
  const amountStr = amount.toFixed(2)

  const payload =
    emvField('00', '01') +
    merchAcc +
    emvField('52', '0000') +
    emvField('53', '986') +
    emvField('54', amountStr) +
    emvField('58', 'BR') +
    emvField('59', merchant) +
    emvField('60', city) +
    emvField('62', emvField('05', txid)) +
    '6304'

  return payload + crc16(payload)
}
