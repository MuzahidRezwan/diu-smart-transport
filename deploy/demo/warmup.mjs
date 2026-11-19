// Signs in as the demo transport office and publishes the optimizer's suggestion
// for today and the next three service days. Demo mode skips 2FA.
const api = process.argv[2];
const call = async (path, body, token) => {
  const res = await fetch(api + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: ${res.status} ${data?.error?.message ?? ''}`);
  return data;
};
const { accessToken } = await call('/auth/authority/login', { universityId: '710215', password: process.env.DEMO_ADMIN_PASSWORD });
let published = 0;
for (let i = 0; published < 4 && i < 8; i++) {
  const d = new Date(Date.now() + 6 * 3600e3 + i * 86400e3); // Asia/Dhaka calendar day
  if (d.getUTCDay() === 5) continue; // Friday: no service
  const day = d.toISOString().slice(0, 10);
  try {
    await call('/admin/allocations/suggest', { serviceDate: day, onlyEmpty: true }, accessToken);
    await call('/admin/allocations/publish-day', { serviceDate: day }, accessToken);
    published++;
    console.log(`Published suggested buses for ${day}`);
  } catch (err) {
    console.log(`Skipped ${day}: ${err.message}`);
  }
}
