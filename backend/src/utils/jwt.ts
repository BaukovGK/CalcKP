import { SignJWT, jwtVerify, type JWTPayload } from 'jose'

const encoder = new TextEncoder()

function getSecret() {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET is not set')
  return encoder.encode(s)
}

export interface TokenPayload extends JWTPayload {
  userId: string
  role: string
}

export async function signAccess(payload: Omit<TokenPayload, 'iat' | 'exp'>) {
  const expires = process.env.JWT_ACCESS_EXPIRES ?? '15m'
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(getSecret())
}

export async function signRefresh(payload: Omit<TokenPayload, 'iat' | 'exp'>) {
  const expires = process.env.JWT_REFRESH_EXPIRES ?? '7d'
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(getSecret())
}

export async function verifyToken(token: string): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, getSecret())
  return payload as TokenPayload
}
