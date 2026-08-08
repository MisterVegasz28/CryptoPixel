import React from 'react';
import { Link } from 'react-router-dom';

const sectionStyle: React.CSSProperties = { marginBottom: 24 };
const h2Style: React.CSSProperties = { color: 'var(--text-primary)', fontSize: 16, marginBottom: 8 };
const pStyle: React.CSSProperties = { color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.7, margin: 0 };
const strongWarn: React.CSSProperties = { color: 'var(--color-amber)' };

function TermsOfService() {
    return (
        <div style={{
            maxWidth: 720, margin: '0 auto', padding: '48px 24px',
            color: 'var(--text-primary)', fontFamily: 'inherit', height: '100vh', overflowY: 'auto',
        }}>
            <Link to="/" style={{ color: 'var(--color-primary)', fontSize: 13, textDecoration: 'none' }}>
                ← Back to CryptoPixel
            </Link>

            <h1 style={{ fontSize: 24, marginTop: 24, marginBottom: 4 }}>Terms of Service</h1>
            <p style={{ color: 'var(--text-faint)', fontSize: 12, marginBottom: 32 }}>
                Last updated: 08/08/2026
            </p>

            <p style={{ ...pStyle, marginBottom: 24 }}>
                By connecting your wallet or otherwise using CryptoPixel (the &quot;Service&quot;), you agree to these
                Terms. CryptoPixel is currently operated by an individual, not a registered company. If you do not
                agree, do not use the Service.
            </p>

            <section style={sectionStyle}>
                <h2 style={h2Style}>1. Description of the Service</h2>
                <p style={pStyle}>
                    CryptoPixel is a decentralized application on the Polygon blockchain allowing users to buy the PAINT
                    token, paint and freeze pixels on a shared canvas. Freezing is irreversible and permanently recorded
                    on-chain.
                </p>
            </section>

            <section style={sectionStyle}>
                <h2 style={h2Style}>2. Eligibility</h2>
                <p style={pStyle}>
                    You must be legally able to enter a binding contract in your jurisdiction, and responsible for
                    ensuring your use of cryptocurrency is legal where you reside.
                </p>
            </section>

            <section style={sectionStyle}>
                <h2 style={h2Style}>3. Wallet Security</h2>
                <p style={pStyle}>
                    You are solely responsible for your wallet, private keys, and seed phrases. We never have access to
                    them and will never ask for them. We are not responsible for losses from compromised wallets,
                    phishing, or user error.
                </p>
            </section>

            <section style={sectionStyle}>
                <h2 style={h2Style}>4. Nature of PAINT and Blockchain Risks</h2>
                <p style={pStyle}>
                    <span style={strongWarn}>PAINT is a utility token with no guaranteed value, liquidity, or price.</span>
                    {' '}You acknowledge: crypto values are volatile and may go to zero; smart contracts may contain bugs
                    despite audits; blockchain transactions are irreversible; gas fees fluctuate outside our control;
                    network issues may affect availability; freezing a pixel is permanent and cannot be undone by you or
                    us. Only spend what you can afford to lose.
                </p>
            </section>

            <section style={sectionStyle}>
                <h2 style={h2Style}>5. Acceptable Use</h2>
                <p style={pStyle}>
                    Do not exploit or attack the Service or its infrastructure; use bots to circumvent rate-limiting;
                    post illegal, hateful, or infringing content via profile fields; or impersonate others. We may
                    restrict off-chain features (profile, leaderboard) for violations — we cannot restrict on-chain
                    actions, which occur outside our control.
                </p>
            </section>

            <section style={sectionStyle}>
                <h2 style={h2Style}>6. Intellectual Property</h2>
                <p style={pStyle}>
                    Pixel art on the shared canvas is collaborative user-generated content. Your on-chain ownership of
                    specific pixels belongs to your wallet per the smart contract&apos;s logic. The CryptoPixel name, logo,
                    and interface belong to the Service operator.
                </p>
            </section>

            <section style={sectionStyle}>
                <h2 style={h2Style}>7. No Warranty</h2>
                <p style={pStyle}>
                    The Service is provided &quot;as is&quot; and &quot;as available&quot;, without warranties of any kind, express
                    or implied.
                </p>
            </section>

            <section style={sectionStyle}>
                <h2 style={h2Style}>8. Limitation of Liability</h2>
                <p style={pStyle}>
                    To the maximum extent permitted by law, we are not liable for indirect, incidental, or consequential
                    damages, or loss of profits, tokens, or data, arising from smart contract bugs, blockchain failures,
                    third-party infrastructure outages, or loss of wallet access.
                </p>
            </section>

            <section style={sectionStyle}>
                <h2 style={h2Style}>9. Changes to the Service</h2>
                <p style={pStyle}>
                    We may modify, suspend, or discontinue the off-chain Service at any time. The smart contract, once
                    deployed, operates independently and its core logic cannot be unilaterally changed by us.
                </p>
            </section>

            <section style={sectionStyle}>
                <h2 style={h2Style}>10. Governing Law</h2>
                <p style={pStyle}>
                    These Terms are governed by French law. Disputes are subject to the exclusive jurisdiction of
                    competent French courts, without prejudice to any mandatory consumer protection rights under your
                    country of residence&apos;s laws.
                </p>
            </section>

            <section style={sectionStyle}>
                <h2 style={h2Style}>11. Contact</h2>
                <p style={pStyle}>
                    For questions about these Terms:{' '}
                    <a href="mailto:cryptopixel.support@gmail.com" style={{ color: 'var(--color-primary)' }}>
                        cryptopixel.support@gmail.com
                    </a>
                </p>
            </section>
        </div>
    );
}

export default React.memo(TermsOfService);