import React from 'react';
import { Link } from 'react-router-dom';

const sectionStyle: React.CSSProperties = { marginBottom: 24 };
const h2Style: React.CSSProperties = { color: 'var(--text-primary)', fontSize: 16, marginBottom: 8 };
const pStyle: React.CSSProperties = { color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.7, margin: 0 };

function PrivacyPolicy() {
    return (
        <div style={{
            maxWidth: 720, margin: '0 auto', padding: '48px 24px',
            color: 'var(--text-primary)', fontFamily: 'inherit', height: '100vh', overflowY: 'auto',
        }}>
            <Link to="/" style={{ color: 'var(--color-primary)', fontSize: 13, textDecoration: 'none' }}>
                ← Back to CryptoPixel
            </Link>

            <h1 style={{ fontSize: 24, marginTop: 24, marginBottom: 4 }}>Privacy Policy</h1>
            <p style={{ color: 'var(--text-faint)', fontSize: 12, marginBottom: 32 }}>
                Last updated: [DATE]
            </p>

            <p style={{ ...pStyle, marginBottom: 24 }}>
                This Privacy Policy explains how CryptoPixel (&quot;we&quot;, &quot;us&quot;, &quot;the Service&quot;) collects,
                uses, and protects information when you use the CryptoPixel decentralized application (the &quot;dApp&quot;).
                CryptoPixel is currently operated by an individual, not a registered company.
            </p>

            <section style={sectionStyle}>
                <h2 style={h2Style}>1. Data We Collect</h2>
                <p style={pStyle}>
                    <strong>Wallet address:</strong> processed when you connect your wallet — publicly visible on the
                    Polygon blockchain by design.<br /><br />
                    <strong>Profile information (optional):</strong> pseudo, bio, and social handles you may choose to
                    add via &quot;Edit Profile&quot;. Public and entirely optional.<br /><br />
                    <strong>On-chain data:</strong> your transactions (buy/sell/freeze/paint) are permanently recorded on
                    the Polygon blockchain, outside our control.<br /><br />
                    <strong>IP address:</strong> temporarily processed for rate-limiting / abuse prevention only.<br /><br />
                    <strong>Cookies/analytics:</strong> we do not currently use cookies or third-party trackers.
                </p>
            </section>

            <section style={sectionStyle}>
                <h2 style={h2Style}>2. How We Use Your Data</h2>
                <p style={pStyle}>
                    Solely to operate the dApp (canvas display, pixel freezing/painting, leaderboards, profiles) and to
                    prevent abuse of our infrastructure. We do not sell your data or use it for advertising.
                </p>
            </section>

            <section style={sectionStyle}>
                <h2 style={h2Style}>3. Third-Party Service Providers</h2>
                <p style={pStyle}>
                    We rely on Supabase (database/edge functions), Railway (hosting), Alchemy (blockchain RPC), and
                    WalletConnect/Web3Modal (wallet connections) to operate the Service. These providers may process data
                    outside your country of residence.
                </p>
            </section>

            <section style={sectionStyle}>
                <h2 style={h2Style}>4. Data Retention</h2>
                <p style={pStyle}>
                    Profile data is retained until updated or deleted. Rate-limit records are kept briefly for security
                    purposes. On-chain data is permanent (see Section 6).
                </p>
            </section>

            <section style={sectionStyle}>
                <h2 style={h2Style}>5. Your Rights (GDPR)</h2>
                <p style={pStyle}>
                    If you are in the EEA, you have the right to access, correct, delete (where we control the data),
                    object to, or port your personal data. Contact us via Section 8 to exercise these rights.
                </p>
            </section>

            <section style={sectionStyle}>
                <h2 style={h2Style}>6. Blockchain Data Is Permanent</h2>
                <p style={pStyle}>
                    Because CryptoPixel operates on Polygon, wallet addresses, transaction history, and frozen/painted
                    pixels are recorded on a public, immutable ledger. We cannot alter or delete this on-chain data, even
                    upon request — this is a fundamental property of blockchain technology, not a limitation of our
                    Service. Off-chain data we control (profile fields) can be deleted upon request.
                </p>
            </section>

            <section style={sectionStyle}>
                <h2 style={h2Style}>7. Security</h2>
                <p style={pStyle}>
                    We apply reasonable technical measures to protect data we control. You are solely responsible for
                    securing your own wallet and private keys — we never have access to them and will never ask for them.
                </p>
            </section>

            <section style={sectionStyle}>
                <h2 style={h2Style}>8. Contact</h2>
                <p style={pStyle}>
                    For privacy-related questions or requests:{' '}
                    <a href="mailto:cryptopixel.support@gmail.com" style={{ color: 'var(--color-primary)' }}>
                        cryptopixel.support@gmail.com
                    </a>
                </p>
            </section>

            <section style={sectionStyle}>
                <h2 style={h2Style}>9. Changes to This Policy</h2>
                <p style={pStyle}>
                    We may update this Privacy Policy from time to time. Material changes will be reflected by updating
                    the &quot;Last updated&quot; date above.
                </p>
            </section>

            <section style={sectionStyle}>
                <h2 style={h2Style}>10. Governing Law</h2>
                <p style={pStyle}>
                    This Privacy Policy is governed by French law, without prejudice to any mandatory data protection
                    rights you may have under the laws of your country of residence (including GDPR, if applicable).
                </p>
            </section>

            <p style={{ color: 'var(--text-faint)', fontSize: 11, marginTop: 40, fontStyle: 'italic' }}>
                This document is a template and does not constitute legal advice.
            </p>
        </div>
    );
}

export default React.memo(PrivacyPolicy);