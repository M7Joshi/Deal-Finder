import React, { useState } from 'react';
import {
  Button, TextField, Alert, Paper, Typography, Box, CircularProgress,
  Card, CardContent, Divider
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import PersonIcon from '@mui/icons-material/Person';
import PhoneIcon from '@mui/icons-material/Phone';
import EmailIcon from '@mui/icons-material/Email';
import BusinessIcon from '@mui/icons-material/Business';
import { apiFetch } from '../helpers';

interface AgentData {
  name: string | null;
  phone: string | null;
  email: string | null;
  brokerage: string | null;
}

interface LookupResult {
  ok: boolean;
  address: string;
  agent?: AgentData;
  hasData?: boolean;
  error?: string;
  requiresOTP?: boolean;
  message?: string;
}

export default function AgentLookup() {
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [status, setStatus] = useState<{ message: string; type: 'info' | 'success' | 'error' | 'warning' } | null>(null);

  const lookupAgent = async () => {
    if (!address.trim()) {
      setStatus({ message: 'Please enter an address', type: 'warning' });
      return;
    }

    setLoading(true);
    setResult(null);
    setStatus({ message: 'Searching Privy for agent details...', type: 'info' });

    try {
      const res = await apiFetch('/api/agent-lookup', {
        method: 'POST',
        body: JSON.stringify({ address: address.trim() }),
      });

      const data: LookupResult = await res.json();

      if (data.requiresOTP) {
        setStatus({ message: 'Privy requires 2FA verification. Enter the code sent to your email.', type: 'warning' });
        setResult(data);
      } else if (data.ok) {
        setResult(data);
        if (data.hasData) {
          setStatus({ message: 'Agent details found!', type: 'success' });
        } else {
          setStatus({ message: 'Property found but no agent details available', type: 'info' });
        }
      } else {
        setStatus({ message: data.error || 'Failed to lookup agent', type: 'error' });
        setResult(data);
      }
    } catch (error: any) {
      setStatus({ message: `Error: ${error.message}`, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const submitOTP = async () => {
    if (otpCode.length !== 6) {
      setStatus({ message: 'Please enter a 6-digit code', type: 'warning' });
      return;
    }

    setStatus({ message: 'Submitting verification code...', type: 'info' });

    try {
      const res = await apiFetch('/api/automation/otp', {
        method: 'POST',
        body: JSON.stringify({ code: otpCode, service: 'privy' }),
      });

      const data = await res.json();

      if (res.ok && data.ok) {
        setOtpCode('');
        setStatus({ message: 'Code submitted! Try searching again.', type: 'success' });
      } else {
        setStatus({ message: data.error || 'Failed to submit code', type: 'error' });
      }
    } catch (error: any) {
      setStatus({ message: `Error: ${error.message}`, type: 'error' });
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      lookupAgent();
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <Typography variant="h4" sx={{ fontWeight: 800, color: '#111827', mb: 1 }}>
          Agent Lookup
        </Typography>
        <Typography variant="body1" sx={{ color: '#6b7280' }}>
          Enter a property address to look up listing agent details from Privy
        </Typography>
      </div>

      {/* Search Box */}
      <Paper
        elevation={0}
        sx={{
          p: 3,
          mb: 3,
          border: '1px solid #e5e7eb',
          borderRadius: 3,
          background: '#fff'
        }}
      >
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
          <TextField
            fullWidth
            label="Property Address"
            placeholder="e.g., 123 Main Street, Albany, NY 12345"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyPress={handleKeyPress}
            variant="outlined"
            sx={{
              '& .MuiOutlinedInput-root': {
                '& fieldset': { borderColor: '#d1d5db' },
                '&:hover fieldset': { borderColor: '#9ca3af' },
                '&.Mui-focused fieldset': { borderColor: '#7c3aed' },
              },
              '& .MuiInputLabel-root.Mui-focused': { color: '#7c3aed' },
            }}
          />
          <Button
            variant="contained"
            onClick={lookupAgent}
            disabled={loading || !address.trim()}
            startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <SearchIcon />}
            sx={{
              backgroundColor: '#7c3aed',
              '&:hover': { backgroundColor: '#6d28d9' },
              '&:disabled': { backgroundColor: '#9ca3af' },
              textTransform: 'none',
              fontWeight: 600,
              px: 4,
              py: 1.8,
              minWidth: 140
            }}
          >
            {loading ? 'Searching...' : 'Lookup'}
          </Button>
        </Box>
      </Paper>

      {/* Status Message */}
      {status && (
        <Alert
          severity={status.type}
          sx={{ mb: 3 }}
          onClose={() => setStatus(null)}
        >
          {status.message}
        </Alert>
      )}

      {/* OTP Box - Show when required */}
      {result?.requiresOTP && (
        <Paper
          elevation={0}
          sx={{
            p: 2,
            mb: 3,
            background: '#fef3c7',
            border: '1px solid #f59e0b',
            borderRadius: 2
          }}
        >
          <Typography variant="subtitle2" sx={{ color: '#92400e', fontWeight: 600, mb: 1 }}>
            Privy 2FA Verification Required
          </Typography>
          <Typography variant="caption" sx={{ color: '#78350f', display: 'block', mb: 2 }}>
            Enter the 6-digit code sent to your email
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <TextField
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="000000"
              size="small"
              inputProps={{
                maxLength: 6,
                style: { textAlign: 'center', fontSize: '1.2rem', letterSpacing: '0.3rem', fontWeight: 'bold' }
              }}
              sx={{ width: 160 }}
            />
            <Button
              variant="contained"
              onClick={submitOTP}
              disabled={otpCode.length !== 6}
              sx={{
                backgroundColor: '#f59e0b',
                '&:hover': { backgroundColor: '#d97706' },
                textTransform: 'none',
                fontWeight: 600
              }}
            >
              Submit Code
            </Button>
          </Box>
        </Paper>
      )}

      {/* Results */}
      {result && result.ok && result.agent && (
        <Card
          elevation={0}
          sx={{
            border: '1px solid #e5e7eb',
            borderRadius: 3,
            overflow: 'hidden'
          }}
        >
          <Box
            sx={{
              background: 'linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)',
              color: '#fff',
              p: 2
            }}
          >
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Agent Details
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.9, mt: 0.5 }}>
              {result.address}
            </Typography>
          </Box>

          <CardContent sx={{ p: 3 }}>
            {result.hasData ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                {/* Agent Name */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Box
                    sx={{
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      backgroundColor: '#f3e8ff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <PersonIcon sx={{ color: '#7c3aed' }} />
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ color: '#6b7280', display: 'block' }}>
                      Agent Name
                    </Typography>
                    <Typography variant="body1" sx={{ fontWeight: 600, color: '#111827' }}>
                      {result.agent.name || '—'}
                    </Typography>
                  </Box>
                </Box>

                <Divider />

                {/* Phone */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Box
                    sx={{
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      backgroundColor: '#dcfce7',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <PhoneIcon sx={{ color: '#16a34a' }} />
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ color: '#6b7280', display: 'block' }}>
                      Phone
                    </Typography>
                    <Typography variant="body1" sx={{ fontWeight: 600, color: '#111827' }}>
                      {result.agent.phone ? (
                        <a href={`tel:${result.agent.phone}`} style={{ color: '#16a34a', textDecoration: 'none' }}>
                          {result.agent.phone}
                        </a>
                      ) : '—'}
                    </Typography>
                  </Box>
                </Box>

                <Divider />

                {/* Email */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Box
                    sx={{
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      backgroundColor: '#dbeafe',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <EmailIcon sx={{ color: '#2563eb' }} />
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ color: '#6b7280', display: 'block' }}>
                      Email
                    </Typography>
                    <Typography variant="body1" sx={{ fontWeight: 600, color: '#111827' }}>
                      {result.agent.email ? (
                        <a href={`mailto:${result.agent.email}`} style={{ color: '#2563eb', textDecoration: 'none' }}>
                          {result.agent.email}
                        </a>
                      ) : '—'}
                    </Typography>
                  </Box>
                </Box>

                <Divider />

                {/* Brokerage */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Box
                    sx={{
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      backgroundColor: '#fef3c7',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <BusinessIcon sx={{ color: '#d97706' }} />
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ color: '#6b7280', display: 'block' }}>
                      Brokerage
                    </Typography>
                    <Typography variant="body1" sx={{ fontWeight: 600, color: '#111827' }}>
                      {result.agent.brokerage || '—'}
                    </Typography>
                  </Box>
                </Box>
              </Box>
            ) : (
              <Box sx={{ textAlign: 'center', py: 3 }}>
                <Typography variant="body1" sx={{ color: '#6b7280' }}>
                  No agent details found for this property.
                </Typography>
                <Typography variant="caption" sx={{ color: '#9ca3af', display: 'block', mt: 1 }}>
                  The property may not have agent information listed in Privy.
                </Typography>
              </Box>
            )}
          </CardContent>
        </Card>
      )}

      {/* Error Result */}
      {result && !result.ok && !result.requiresOTP && (
        <Paper
          elevation={0}
          sx={{
            p: 3,
            border: '1px solid #fecaca',
            borderRadius: 2,
            background: '#fef2f2'
          }}
        >
          <Typography variant="subtitle1" sx={{ color: '#dc2626', fontWeight: 600, mb: 1 }}>
            Lookup Failed
          </Typography>
          <Typography variant="body2" sx={{ color: '#7f1d1d' }}>
            {result.error || 'Unable to find agent details for this address.'}
          </Typography>
        </Paper>
      )}

      {/* Usage Tips */}
      <Paper
        elevation={0}
        sx={{
          p: 2,
          mt: 3,
          border: '1px solid #e5e7eb',
          borderRadius: 2,
          background: '#f9fafb'
        }}
      >
        <Typography variant="subtitle2" sx={{ color: '#374151', fontWeight: 600, mb: 1 }}>
          Tips for best results:
        </Typography>
        <Typography variant="body2" component="ul" sx={{ color: '#6b7280', pl: 2, m: 0 }}>
          <li>Enter the full property address including city, state, and ZIP code</li>
          <li>Make sure the property is listed on Privy</li>
          <li>If prompted for 2FA, enter the code from your email</li>
        </Typography>
      </Paper>
    </div>
  );
}
