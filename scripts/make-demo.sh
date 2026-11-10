#!/usr/bin/env bash
# Builds the demo used for the README screenshots: two repositories with agent branches and
# worktrees, and a Gitgel config for them, in a home folder of their own.
#
# Development tool only: it uses the git CLI and writes, but only inside $ROOT, which it creates
# itself and marks with a marker file. Launching the app with HOME set to the demo home keeps
# the user's own config, repositories and logs out of it.
#
#   scripts/make-demo.sh          (re)create the demo
#   scripts/make-demo.sh open     launch Gitgel on the demo (GITGEL_APP picks the .app)
set -euo pipefail

ROOT="${GITGEL_DEMO:-$HOME/gitgel-demo}"
DEMO_HOME="$ROOT/home"
CODE="$DEMO_HOME/code"
MARKER=".gitgel-demo"
APP="${GITGEL_APP:-$(cd "$(dirname "$0")/.." && pwd)/src-tauri/target/release/bundle/macos/Gitgel.app}"

export GIT_AUTHOR_NAME="Alex Kim" GIT_AUTHOR_EMAIL=alex@example.com
export GIT_COMMITTER_NAME="Alex Kim" GIT_COMMITTER_EMAIL=alex@example.com
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

die() { echo "make-demo: $*" >&2; exit 1; }

# Commit timestamps: <days> days and <hours> hours ago, a few seconds apart for a stable order.
SEQ=0
at() {
  SEQ=$((SEQ + 1))
  local t=$(( $(date +%s) - $1 * 86400 - ${2:-0} * 3600 + SEQ * 10 ))
  export GIT_AUTHOR_DATE="$t +0000" GIT_COMMITTER_DATE="$t +0000"
}

# put <dir> <path>, content on stdin
put() {
  mkdir -p "$(dirname "$1/$2")"
  cat > "$1/$2"
}

# commit <dir> <days ago> <hours ago> <message>
commit() {
  at "$2" "$3"
  git -C "$1" add -A
  git -C "$1" commit -q -m "$4"
}

# clone <name>: an empty origin and a clone of it, main pushed later by publish.
clone() {
  git init -q --bare -b main "$ROOT/remotes/$1.git"
  git clone -q "$ROOT/remotes/$1.git" "$CODE/$1" 2>/dev/null
  git -C "$CODE/$1" switch -q -c main 2>/dev/null || true
}

publish() {
  git -C "$CODE/$1" push -q origin main
  git -C "$CODE/$1" remote set-head origin main
}

make_web() {
  local r="$CODE/storefront"
  clone storefront

  put "$r" package.json <<'EOF'
{
  "name": "storefront",
  "private": true,
  "scripts": { "dev": "vite", "build": "tsc && vite build", "test": "vitest run" },
  "dependencies": { "react": "19.1.0", "react-dom": "19.1.0" }
}
EOF
  put "$r" src/lib/money.ts <<'EOF'
export type Money = { amount: number; currency: string };

export function formatMoney({ amount, currency }: Money): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

export function sum(items: Money[]): Money {
  const currency = items[0]?.currency ?? 'USD';
  return { amount: items.reduce((total, item) => total + item.amount, 0), currency };
}
EOF
  put "$r" src/checkout/Cart.tsx <<'EOF'
import { formatMoney, sum } from '../lib/money';
import type { CartItem } from './types';

export function Cart({ items }: { items: CartItem[] }) {
  const total = sum(items.map((item) => item.price));

  return (
    <section className="cart">
      <h2>Your cart</h2>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <span>{item.name}</span>
            <span>{formatMoney(item.price)}</span>
          </li>
        ))}
      </ul>
      <p className="total">Total: {formatMoney(total)}</p>
    </section>
  );
}
EOF
  put "$r" src/checkout/Checkout.tsx <<'EOF'
import { useState } from 'react';
import { Cart } from './Cart';
import { PaymentForm } from './PaymentForm';
import type { CartItem } from './types';

export function Checkout({ items }: { items: CartItem[] }) {
  const [paid, setPaid] = useState(false);

  if (paid) return <p>Thanks for your order!</p>;

  return (
    <main className="checkout">
      <Cart items={items} />
      <PaymentForm onPaid={() => setPaid(true)} />
    </main>
  );
}
EOF
  put "$r" src/checkout/PaymentForm.tsx <<'EOF'
import { useState } from 'react';

export function PaymentForm({ onPaid }: { onPaid: () => void }) {
  const [card, setCard] = useState('');
  const [expiry, setExpiry] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await fetch('/api/payments', {
      method: 'POST',
      body: JSON.stringify({ card, expiry }),
    });
    onPaid();
  }

  return (
    <form onSubmit={submit}>
      <input placeholder="Card number" value={card} onChange={(e) => setCard(e.target.value)} />
      <input placeholder="MM/YY" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
      <button type="submit">Pay</button>
    </form>
  );
}
EOF
  put "$r" src/checkout/types.ts <<'EOF'
import type { Money } from '../lib/money';

export type CartItem = { id: string; name: string; price: Money; quantity: number };
EOF
  put "$r" src/theme/tokens.css <<'EOF'
:root {
  --bg: #ffffff;
  --text: #1c1c1e;
  --muted: #6e6e73;
  --accent: #0a84ff;
  --border: #e5e5ea;
}
EOF
  commit "$r" 21 0 "Initial storefront"
  put "$r" README.md <<'EOF'
# Storefront

The shop's web app. `pnpm dev` starts it on port 5173.
EOF
  commit "$r" 9 0 "Add README"
  publish storefront

  # Claude Code: checkout redesign, in a worktree with uncommitted work on top.
  git -C "$r" worktree add -q -b claude/checkout-redesign "$CODE/worktrees/checkout-redesign"
  local w="$CODE/worktrees/checkout-redesign"
  put "$w" src/checkout/Checkout.tsx <<'EOF'
import { useState } from 'react';
import { Cart } from './Cart';
import { OrderSummary } from './OrderSummary';
import { PaymentForm } from './PaymentForm';
import type { CartItem } from './types';

type Step = 'cart' | 'payment' | 'done';

export function Checkout({ items }: { items: CartItem[] }) {
  const [step, setStep] = useState<Step>('cart');

  if (step === 'done') return <p>Thanks for your order!</p>;

  return (
    <main className="checkout">
      <div className="checkout-main">
        {step === 'cart' && <Cart items={items} onContinue={() => setStep('payment')} />}
        {step === 'payment' && <PaymentForm onPaid={() => setStep('done')} />}
      </div>
      <OrderSummary items={items} />
    </main>
  );
}
EOF
  commit "$w" 2 5 "Split checkout into cart and payment steps"
  put "$w" src/checkout/OrderSummary.tsx <<'EOF'
import { formatMoney, sum } from '../lib/money';
import type { CartItem } from './types';

const SHIPPING = { amount: 4.99, currency: 'USD' };

export function OrderSummary({ items }: { items: CartItem[] }) {
  const subtotal = sum(items.map((item) => item.price));
  const total = sum([subtotal, SHIPPING]);

  return (
    <aside className="order-summary">
      <h3>Order summary</h3>
      <dl>
        <dt>Subtotal</dt>
        <dd>{formatMoney(subtotal)}</dd>
        <dt>Shipping</dt>
        <dd>{formatMoney(SHIPPING)}</dd>
        <dt>Total</dt>
        <dd className="total">{formatMoney(total)}</dd>
      </dl>
    </aside>
  );
}
EOF
  commit "$w" 2 3 "Add order summary sidebar"
  put "$w" src/checkout/PaymentForm.tsx <<'EOF'
import { useState } from 'react';
import { validateCard, validateExpiry } from './validation';

export function PaymentForm({ onPaid }: { onPaid: () => void }) {
  const [card, setCard] = useState('');
  const [expiry, setExpiry] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const problem = validateCard(card) ?? validateExpiry(expiry);
    if (problem) {
      setError(problem);
      return;
    }
    const response = await fetch('/api/checkout/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card, expiry }),
    });
    if (!response.ok) {
      setError('Payment failed. Try another card.');
      return;
    }
    onPaid();
  }

  return (
    <form onSubmit={submit} noValidate>
      <input placeholder="Card number" value={card} onChange={(e) => setCard(e.target.value)} />
      <input placeholder="MM/YY" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
      {error && <p role="alert">{error}</p>}
      <button type="submit">Pay now</button>
    </form>
  );
}
EOF
  put "$w" src/checkout/validation.ts <<'EOF'
export function validateCard(card: string): string | null {
  const digits = card.replace(/\s/g, '');
  if (!/^\d{13,19}$/.test(digits)) return 'Enter a valid card number.';
  return null;
}

export function validateExpiry(expiry: string): string | null {
  const match = /^(\d{2})\/(\d{2})$/.exec(expiry);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 12) return 'Use MM/YY.';
  return null;
}
EOF
  commit "$w" 0 4 "Validate card fields before paying"
  # Uncommitted: a Back button and a test file.
  sed -i '' "s|{step === 'payment' \&\& <PaymentForm onPaid={() => setStep('done')} />}|{step === 'payment' \&\& (\\
          <PaymentForm onBack={() => setStep('cart')} onPaid={() => setStep('done')} />\\
        )}|" "$w/src/checkout/Checkout.tsx"
  put "$w" src/checkout/validation.test.ts <<'EOF'
import { describe, expect, it } from 'vitest';
import { validateCard, validateExpiry } from './validation';

describe('validateCard', () => {
  it('accepts 16 digits with spaces', () => {
    expect(validateCard('4242 4242 4242 4242')).toBeNull();
  });
  it('rejects letters', () => {
    expect(validateCard('4242 abcd')).not.toBeNull();
  });
});

describe('validateExpiry', () => {
  it('rejects month 13', () => {
    expect(validateExpiry('13/29')).not.toBeNull();
  });
});
EOF

  # Cursor: dark mode.
  git -C "$r" switch -q -c cursor/dark-mode main
  put "$r" src/theme/tokens.css <<'EOF'
:root {
  --bg: #ffffff;
  --text: #1c1c1e;
  --muted: #6e6e73;
  --accent: #0a84ff;
  --border: #e5e5ea;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1c1c1e;
    --text: #f2f2f7;
    --muted: #98989d;
    --accent: #0a84ff;
    --border: #38383a;
  }
}
EOF
  commit "$r" 1 6 "Add dark color tokens"
  put "$r" index.html <<'EOF'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="color-scheme" content="light dark" />
    <title>Storefront</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
EOF
  commit "$r" 1 5 "Follow the system appearance"

  # Codex: rounding fix.
  git -C "$r" switch -q -c codex/fix-cart-total main
  put "$r" src/lib/money.ts <<'EOF'
export type Money = { amount: number; currency: string };

export function formatMoney({ amount, currency }: Money): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

/** Adds in cents, so 0.1 + 0.2 is 0.30 and not 0.30000000000000004. */
export function sum(items: Money[]): Money {
  const currency = items[0]?.currency ?? 'USD';
  const cents = items.reduce((total, item) => total + Math.round(item.amount * 100), 0);
  return { amount: cents / 100, currency };
}
EOF
  commit "$r" 0 20 "Add cart totals in cents"

  git -C "$r" switch -q main
}

make_api() {
  local r="$CODE/orders-api"
  clone orders-api

  put "$r" go.mod <<'EOF'
module example.com/orders-api

go 1.23
EOF
  put "$r" cmd/server/main.go <<'EOF'
package main

import (
	"log"
	"net/http"

	"example.com/orders-api/internal/orders"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /orders/{id}", orders.Get)
	mux.HandleFunc("POST /payments", orders.Pay)

	log.Println("listening on :8080")
	log.Fatal(http.ListenAndServe(":8080", mux))
}
EOF
  put "$r" internal/orders/handler.go <<'EOF'
package orders

import (
	"encoding/json"
	"net/http"
)

type Order struct {
	ID    string  `json:"id"`
	Total float64 `json:"total"`
}

func Get(w http.ResponseWriter, r *http.Request) {
	order := Order{ID: r.PathValue("id")}
	json.NewEncoder(w).Encode(order)
}

func Pay(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusAccepted)
}
EOF
  commit "$r" 30 0 "Initial orders API"
  put "$r" internal/orders/store.go <<'EOF'
package orders

import "sync"

type Store struct {
	mu     sync.RWMutex
	orders map[string]Order
}

func NewStore() *Store {
	return &Store{orders: map[string]Order{}}
}

func (s *Store) Get(id string) (Order, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	order, ok := s.orders[id]
	return order, ok
}
EOF
  commit "$r" 12 0 "Keep orders in memory"
  publish orders-api

  # Claude Code: the API half of the checkout redesign.
  git -C "$r" switch -q -c claude/checkout-redesign main
  put "$r" internal/orders/session.go <<'EOF'
package orders

import (
	"encoding/json"
	"net/http"
)

type SessionRequest struct {
	Card   string `json:"card"`
	Expiry string `json:"expiry"`
}

type Session struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

// CreateSession starts a checkout session for the cart in the request.
func CreateSession(w http.ResponseWriter, r *http.Request) {
	var req SessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Session{ID: newID(), Status: "pending"})
}
EOF
  commit "$r" 2 4 "Add checkout session endpoint"
  put "$r" cmd/server/main.go <<'EOF'
package main

import (
	"log"
	"net/http"

	"example.com/orders-api/internal/orders"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /orders/{id}", orders.Get)
	mux.HandleFunc("POST /checkout/session", orders.CreateSession)

	log.Println("listening on :8080")
	log.Fatal(http.ListenAndServe(":8080", mux))
}
EOF
  commit "$r" 0 5 "Route checkout sessions, drop /payments"

  # Codex: rate limiting, in a worktree.
  git -C "$r" worktree add -q -b codex/rate-limit "$CODE/worktrees/rate-limit" main
  local w="$CODE/worktrees/rate-limit"
  put "$w" internal/ratelimit/limiter.go <<'EOF'
package ratelimit

import (
	"sync"
	"time"
)

// Limiter is a token bucket per client key.
type Limiter struct {
	mu      sync.Mutex
	rate    float64
	burst   float64
	buckets map[string]*bucket
}

type bucket struct {
	tokens float64
	last   time.Time
}

func New(perSecond, burst float64) *Limiter {
	return &Limiter{rate: perSecond, burst: burst, buckets: map[string]*bucket{}}
}

func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{tokens: l.burst, last: now}
		l.buckets[key] = b
	}
	b.tokens = min(l.burst, b.tokens+now.Sub(b.last).Seconds()*l.rate)
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}
EOF
  commit "$w" 3 2 "Add a token bucket limiter"
  put "$w" internal/ratelimit/middleware.go <<'EOF'
package ratelimit

import (
	"net"
	"net/http"
)

func (l *Limiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, _ := net.SplitHostPort(r.RemoteAddr)
		if !l.Allow(host) {
			http.Error(w, "too many requests", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}
EOF
  commit "$w" 3 1 "Limit requests per client"
  put "$w" internal/ratelimit/limiter_test.go <<'EOF'
package ratelimit

import "testing"

func TestBurst(t *testing.T) {
	l := New(1, 3)
	for i := 0; i < 3; i++ {
		if !l.Allow("a") {
			t.Fatalf("request %d blocked", i)
		}
	}
	if l.Allow("a") {
		t.Fatal("fourth request allowed")
	}
}
EOF
  commit "$w" 1 2 "Test the burst limit"

  # A stash on main.
  git -C "$r" switch -q main
  printf '\nfunc (s *Store) Put(order Order) {\n\ts.mu.Lock()\n\tdefer s.mu.Unlock()\n\ts.orders[order.ID] = order\n}\n' >> "$r/internal/orders/store.go"
  git -C "$r" stash push -q -m "store: add Put"
}

write_config() {
  local dir="$DEMO_HOME/Library/Application Support/com.gitgel.desktop"
  local version now
  version=$(sed -n 's/.*"version": "\(.*\)".*/\1/p' "$(dirname "$0")/../package.json")
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  mkdir -p "$dir"
  cat > "$dir/config.json" <<EOF
{
  "version": 1,
  "repos": [
    { "id": "r_demoweb", "path": "$CODE/storefront" },
    { "id": "r_demoapi", "path": "$CODE/orders-api" }
  ],
  "branchBases": {},
  "projects": [
    {
      "id": "p_democheckout",
      "name": "Checkout redesign",
      "createdAt": "$now",
      "entries": [
        { "repoId": "r_demoweb", "branch": "claude/checkout-redesign", "worktreePath": null, "lastKnownTip": null },
        { "repoId": "r_demoapi", "branch": "claude/checkout-redesign", "worktreePath": null, "lastKnownTip": null }
      ]
    }
  ],
  "settings": {
    "language": "en",
    "checkUpdates": false,
    "lastSeenVersion": "$version"
  },
  "scripts": [],
  "pinnedRepos": []
}
EOF
}

make_all() {
  if [[ -e "$ROOT" ]]; then
    [[ -f "$ROOT/$MARKER" ]] || die "$ROOT exists without a $MARKER marker; refusing to touch it"
    rm -rf "$ROOT"
  fi
  mkdir -p "$CODE" "$ROOT/remotes"
  touch "$ROOT/$MARKER"
  make_web
  make_api
  write_config
  echo "Demo ready in $ROOT. Run: scripts/make-demo.sh open"
}

case "${1:-}" in
  "") make_all ;;
  open)
    [[ -f "$ROOT/$MARKER" ]] || die "no demo in $ROOT; run scripts/make-demo.sh first"
    [[ -x "$APP/Contents/MacOS/gitgel" ]] || die "no app at $APP; build it or set GITGEL_APP"
    HOME="$DEMO_HOME" "$APP/Contents/MacOS/gitgel" >/dev/null 2>&1 &
    echo "Gitgel started on the demo (pid $!)"
    ;;
  *) die "unknown command: $1 (use open)" ;;
esac
