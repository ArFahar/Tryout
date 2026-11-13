import { CanActivate, ExecutionContext, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { SignJWT, jwtVerify, generateKeyPair, exportPKCS8, exportSPKI, importPKCS8, importSPKI, CryptoKey } from 'jose';
import fs from 'node:fs';
import path from 'node:path';
import type { Role } from '@cogniverse/contracts';
import { AppError } from './infra';

// TDD 5.2: access token JWT asimetris, 15 menit, cookie cv_at (Path=/api).
const ALG = 'ES256';
export const ACCESS_TTL_SECONDS = 15 * 60;
let keys: { priv: CryptoKey; pub: CryptoKey } | null = null;

export async function loadKeys() {
  if (keys) return keys;
  if (process.env.JWT_PRIVATE_KEY && process.env.JWT_PUBLIC_KEY) {
    keys = { priv: await importPKCS8(process.env.JWT_PRIVATE_KEY, ALG), pub: await importSPKI(process.env.JWT_PUBLIC_KEY, ALG) };
    return keys;
  }
  // Pengembangan: pasangan kunci dibuat sekali dan disimpan di .data/keys (diabaikan git).
  const dir = path.resolve(__dirname, '../../../../.data/keys');
  const privFile = path.join(dir, 'jwt-private.pem');
  const pubFile = path.join(dir, 'jwt-public.pem');
  if (!fs.existsSync(privFile)) {
    fs.mkdirSync(dir, { recursive: true });
    const kp = await generateKeyPair(ALG, { extractable: true });
    fs.writeFileSync(privFile, await exportPKCS8(kp.privateKey));
    fs.writeFileSync(pubFile, await exportSPKI(kp.publicKey));
  }
  keys = { priv: await importPKCS8(fs.readFileSync(privFile, 'utf8'), ALG), pub: await importSPKI(fs.readFileSync(pubFile, 'utf8'), ALG) };
  return keys;
}

export interface AuthUser { id: string; roles: Role[]; sid: string }

export async function signAccess(u: AuthUser) {
  const { priv } = await loadKeys();
  return new SignJWT({ roles: u.roles, sid: u.sid })
    .setProtectedHeader({ alg: ALG })
    .setSubject(u.id)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(priv);
}

export async function verifyAccess(token: string): Promise<AuthUser | 'expired' | null> {
  const { pub } = await loadKeys();
  try {
    const { payload } = await jwtVerify(token, pub, { algorithms: [ALG] });
    return { id: payload.sub as string, roles: payload.roles as Role[], sid: payload.sid as string };
  } catch (e: any) {
    return e?.code === 'ERR_JWT_EXPIRED' ? 'expired' : null;
  }
}

// Daftar cabut sesi di memori (TDD 5.2 memakai Redis dengan TTL 15 menit).
const revokedSids = new Map<string, number>();
export function revokeSid(sid: string) {
  revokedSids.set(sid, Date.now() + ACCESS_TTL_SECONDS * 1000);
}
function isRevoked(sid: string) {
  const until = revokedSids.get(sid);
  if (!until) return false;
  if (until < Date.now()) { revokedSids.delete(sid); return false; }
  return true;
}

export const PUBLIC = 'isPublic';
export const Public = () => SetMetadata(PUBLIC, true);
export const ROLES_KEY = 'roles';
/** Role minimum; SUPER_ADMIN selalu diizinkan (TDD 4.1). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<Request>();
    const token = req.cookies?.cv_at;
    const user = token ? await verifyAccess(token) : null;
    if (user && user !== 'expired' && !isRevoked(user.sid)) (req as any).user = user;
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    if (user === 'expired') throw new AppError('SESSION_EXPIRED', 'Sesi berakhir. Silakan masuk kembali.');
    if (!(req as any).user) throw new AppError('UNAUTHENTICATED', 'Silakan masuk terlebih dahulu.');
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length) {
      const mine: Role[] = (req as any).user.roles;
      if (!mine.includes('SUPER_ADMIN') && !roles.some((r) => mine.includes(r))) {
        throw new AppError('FORBIDDEN', 'Anda tidak memiliki akses ke halaman ini.');
      }
    }
    return true;
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser =>
  ctx.switchToHttp().getRequest().user);
export const OptionalUser = CurrentUser;
