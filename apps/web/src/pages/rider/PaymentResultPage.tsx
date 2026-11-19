import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

/** Landing page after the payment gateway. The card is activated by the server's IPN, not by this page. */
export function PaymentResultPage() {
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const ok = params.get('status') === 'success';
  useEffect(() => { qc.invalidateQueries({ queryKey: ['my-card'] }); }, [qc]);
  return (
    <main className="mx-auto grid min-h-screen max-w-md content-center gap-3 p-6">
      <div className="card grid gap-2" style={{ background: ok ? 'var(--ok-soft)' : 'var(--crit-soft)', color: ok ? 'var(--ok)' : 'var(--crit)' }}>
        <b className="text-lg">{ok ? 'Payment received' : params.get('status') === 'cancel' ? 'Payment cancelled' : 'Payment did not go through'}</b>
        <span className="text-sm">Transaction {params.get('tran_id')}. {ok ? 'Your card becomes active as soon as the gateway confirms it, usually within a minute.' : 'No money was taken for a failed payment. You can try again.'}</span>
      </div>
      <Link className="btn btn-primary justify-center" to="/app/card">Open My Card</Link>
    </main>
  );
}
