import React, { useState } from 'react';
import { apiFetch } from '../helpers';

interface BofaResult {
  address: string;
  avgSalePrice: number | null;
  estimatedHomeValue: number | null;
  amv: number | null;
  scrapedAt?: string;
}

const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmt = (n?: number | null) => (typeof n === 'number' && n > 0 ? currency.format(n) : '—');

export default function BofaViewer() {
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<BofaResult[]>([]);

  const handleLookup = async () => {
    if (!address.trim()) {
      setError('Please enter an address');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await apiFetch('/api/bofa/lookup', {
        method: 'POST',
        body: JSON.stringify({ address: address.trim() }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(data.message || data.error || 'Lookup failed');
        return;
      }

      // Add to results list
      const newResult: BofaResult = {
        address: data.address,
        avgSalePrice: data.avgSalePrice,
        estimatedHomeValue: data.estimatedHomeValue,
        amv: data.amv,
        scrapedAt: data.scrapedAt,
      };

      setResults(prev => [newResult, ...prev]);
      setAddress(''); // Clear input after successful lookup
    } catch (err: any) {
      setError(err.message || 'Failed to lookup address');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      handleLookup();
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, color: '#111827', marginBottom: 8 }}>
        BofA Home Values
      </h1>
      <p style={{ color: '#6b7280', marginBottom: 24 }}>
        Look up home values from Bank of America's Home Value Real Estate Center
      </p>

      {/* Address Input */}
      <div style={{ marginBottom: 24, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter full address (e.g., 123 Main St, Charlotte, NC 28202)"
          style={{
            flex: 1,
            minWidth: 300,
            padding: '12px 16px',
            fontSize: 14,
            border: '1px solid #d1d5db',
            borderRadius: 8,
            outline: 'none',
          }}
          disabled={loading}
        />
        <button
          onClick={handleLookup}
          disabled={loading || !address.trim()}
          style={{
            padding: '12px 24px',
            fontSize: 14,
            fontWeight: 600,
            color: '#fff',
            backgroundColor: loading ? '#9ca3af' : '#111827',
            border: 'none',
            borderRadius: 8,
            cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'background-color 0.2s',
          }}
        >
          {loading ? 'Looking up...' : 'Lookup'}
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div style={{
          marginBottom: 16,
          padding: 12,
          backgroundColor: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: 8,
          color: '#dc2626',
          fontSize: 14,
        }}>
          {error}
        </div>
      )}

      {/* Loading Indicator */}
      {loading && (
        <div style={{
          marginBottom: 16,
          padding: 16,
          backgroundColor: '#f3f4f6',
          borderRadius: 8,
          color: '#374151',
          fontSize: 14,
          textAlign: 'center',
        }}>
          Looking up home values from BofA... This may take 15-45 seconds.
        </div>
      )}

      {/* Results Table */}
      <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid #e5e7eb' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
          <thead>
            <tr style={{ backgroundColor: '#f9fafb' }}>
              <th style={thStyle}>Address</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Average Sale Price</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Estimated Home Value</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>AMV</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result, index) => (
              <tr key={index} style={{ borderBottom: '1px solid #eef2f7' }}>
                <td style={tdL}>{result.address}</td>
                <td style={tdR}>{fmt(result.avgSalePrice)}</td>
                <td style={tdR}>{fmt(result.estimatedHomeValue)}</td>
                <td style={{ ...tdR, fontWeight: 600 }}>{fmt(result.amv)}</td>
              </tr>
            ))}
            {results.length === 0 && !loading && (
              <tr>
                <td colSpan={4} style={{ ...tdL, textAlign: 'center', color: '#9ca3af', padding: 40 }}>
                  Enter an address above to look up home values
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 24, padding: 16, backgroundColor: '#f3f4f6', borderRadius: 8 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Field Descriptions</h3>
        <ul style={{ margin: 0, paddingLeft: 20, color: '#6b7280', fontSize: 14, lineHeight: 1.8 }}>
          <li><strong>Average Sale Price</strong> - Based on comparable sales in the area</li>
          <li><strong>Estimated Home Value</strong> - BofA's estimate of what the home is worth</li>
          <li><strong>AMV</strong> - Automated Market Value (average of the two estimates)</li>
        </ul>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '14px 16px',
  textAlign: 'left',
  fontWeight: 600,
  color: '#374151',
  fontSize: 13,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: '2px solid #e5e7eb',
};

const tdBase: React.CSSProperties = {
  padding: '14px 16px',
  color: '#111827',
  verticalAlign: 'top',
};

const tdR: React.CSSProperties = { ...tdBase, textAlign: 'right', whiteSpace: 'nowrap' };
const tdL: React.CSSProperties = { ...tdBase, textAlign: 'left' };
