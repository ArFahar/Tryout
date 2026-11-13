import type { NextConfig } from 'next';

const API = process.env.API_ORIGIN ?? 'http://localhost:4000';

const config: NextConfig = {
  transpilePackages: ['@cogniverse/contracts'],
  // Satu origin untuk web dan API sehingga cookie sesi (Path=/api) berlaku (TDD 5.1)
  // UI/UX v2.0: "Ujian Saya" menjadi "Asesmen Saya"
  async redirects() {
    return [
      { source: '/app/ujian-saya', destination: '/app/asesmen', permanent: true },
      // v3.0: perbandingan Free vs Premium menjadi halaman paket; rekomendasi menjadi roadmap
      { source: '/bandingkan', destination: '/paket', permanent: true },
      { source: '/app/rekomendasi', destination: '/app/roadmap', permanent: true },
    ];
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API}/api/:path*` }];
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'DENY' },
      ],
    }];
  },
};
export default config;
