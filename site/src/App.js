// src/App.js
import React, { useEffect, useState } from "react";
import Logo from "./assets/logo.png";
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation, Outlet } from "react-router-dom";
import {
  ThemeProvider, createTheme, CssBaseline,
  Box, AppBar, Toolbar, Typography, IconButton, Drawer, List, ListItemIcon, ListItemButton,
  ListItemText, Divider, useMediaQuery
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";

import Deals from "./screens/Deals.tsx";
import Users from "./screens/Users.tsx";
import PrivyFetcher from "./screens/PrivyFetcher.tsx";
import RedfinFetcher from "./screens/RedfinFetcher.tsx";
import BofaViewer from "./screens/BofaViewer.tsx";
import ScrapedDeals from "./screens/ScrapedDeals.tsx";
// import AgentFetcher from "./screens/AgentFetcher.tsx"; // Commented out - can enable later
import ManageSubadmins from "./screens/ManageSubadmins.tsx";
import PendingAMV from "./screens/PendingAMV.tsx";
import AgentLookup from "./screens/AgentLookup.tsx";
import EmailSent from "./screens/EmailSent.tsx";
import FollowUp from "./screens/FollowUp.tsx";
import DealStatus from "./screens/DealStatus.tsx";
import RedfinAMVTest from "./screens/RedfinAMVTest.tsx";
import RedfinAMVLookup from "./screens/RedfinAMVLookup.tsx";
import Login from "./components/Login/Login.tsx";
import { verify, clearToken } from "./helpers";


// ---- THEME (light mode with clean styling) ----
const theme = createTheme({
  palette: {
    mode: "light",
    background: { default: "#ffffff", paper: "#ffffff" },
    primary: { main: "#111111" },
    secondary: { main: "#a78bfa" },
    text: { primary: "#111827", secondary: "#374151" },
    divider: "rgba(0,0,0,0.08)",
  },
  typography: {
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
    button: { textTransform: "none", fontWeight: 600 }
  },
  shape: { borderRadius: 12 },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
          border: "1px solid rgba(0,0,0,0.08)"
        }
      }
    },
    MuiTableHead: {
      styleOverrides: { root: { backgroundColor: "#f9fafb" } }
    }
  }
});

// ---- AUTH GUARD ----
function Protected({ children }) {
  const authed = Boolean(localStorage.getItem("authToken"));
  return authed ? children : <Navigate to="/login" replace />;
}

// ---- SIDEBAR + LAYOUT ----
const navItems = [
  { label: "Deals", to: "/deals" },  // Everyone can see this
  { label: "Email Sent", to: "/email-sent" },  // Deals where email has been sent
  { label: "Follow Up", to: "/follow-up" },  // Deals needing follow-up
  { label: "Deal Status", to: "/deal-status" },  // Final deal status tracking
  { label: "All Addresses", to: "/all-addresses" },  // Everyone can see this
  { label: "Pending AMV", to: "/pending-amv", adminOnly: true },  // Admin only
  { label: "Agent Lookup", to: "/agent-lookup", adminOnly: true },  // Admin only
  { label: "Privy Fetcher", to: "/privy-fetcher", adminOnly: true },  // Admin only
  { label: "Redfin Fetcher", to: "/redfin-fetcher", adminOnly: true },  // Admin only
  { label: "BofA Viewer", to: "/bofa-viewer", adminOnly: true },  // Admin only
  { label: "AMV Speed Test", to: "/amv-speed-test", adminOnly: true },  // Admin only - New Redfin AMV API test
  { label: "Redfin AMV Lookup", to: "/redfin-amv-lookup", adminOnly: true },  // Admin only - Test AMV lookup
  { label: "Manage Subadmins", to: "/manage-subadmins", adminOnly: true },
  { label: "Users", to: "/users", adminOnly: true },
];

function Sidebar({ open, onClose, isAdmin, onLogout }) {
  const location = useLocation();
  return (
    <Box sx={{
      width: 200,
      height: "100%",
      background: "lightgray",
      overflowY: "auto",
      overflowX: "hidden",
      display: "flex",
      flexDirection: "column",
      justifyContent: "flex-start",
      pt: 4,
      scrollbarWidth: "thin",           // Firefox - thin scrollbar
      "&::-webkit-scrollbar": {         // Chrome/Safari
        width: 6,
      },
      "&::-webkit-scrollbar-thumb": {
        backgroundColor: "#999",
        borderRadius: 3,
      }
    }}>
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", py: 2 }}>
        <img src={Logo} alt="Logo" style={{ maxWidth: "140px", height: "auto" }} />
      </Box>
      <Divider />
      <Box sx={{ flexGrow: 1 }}>
        <List dense sx={{ mt: "auto" }}>
          {navItems
            .filter(n => !n.adminOnly || isAdmin)
            .map(n => {
              const active = location.pathname === n.to;
              return (
                <ListItemButton
                  key={n.to}
                  component={Link}
                  to={n.to}
                  onClick={onClose}
                  selected={active}
                  sx={{
                    my: 0.75,
                    px: 1.25,
                    py: 1.25,
                    borderRadius: 3,
                    color: '#111',
                    transition: 'all .15s ease',
                    border: '1px solid transparent',
                    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                    '&:hover': {
                      bgcolor: '#efefef',
                      borderColor: '#e5e5e5',
                      transform: 'translateY(-1px)'
                    },
                    '&.Mui-selected': {
                      bgcolor: '#e9e9e9',
                      borderColor: '#d4d4d4',
                      '&:hover': { bgcolor: '#e5e5e5' }
                    }
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 28 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: active ? '#111' : '#bdbdbd' }} />
                  </ListItemIcon>
                  <ListItemText
                    primary={n.label}
                    primaryTypographyProps={{
                      fontWeight: active ? 700 : 600,
                      letterSpacing: 0.2,
                      color: '#111'
                    }}
                  />
                </ListItemButton>
              );
            })}
        </List>
      </Box>
      <Box sx={{ flexGrow: 1 }} />
      <Divider />
      <List dense sx={{ mt: 1, mb: 2 }}>
        <ListItemButton
          onClick={() => { onClose && onClose(); onLogout && onLogout(); }}
          sx={{
            my: 0.75,
            px: 1.25,
            py: 1.25,
            borderRadius: 3,
            color: '#111',
            transition: 'all .15s ease',
            border: '1px solid transparent',
            '&:hover': { bgcolor: '#efefef', borderColor: '#e5e5e5', transform: 'translateY(-1px)' }
          }}
        >
          <ListItemIcon sx={{ minWidth: 28 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#b91c1c' }} />
          </ListItemIcon>
          <ListItemText primary="Logout" primaryTypographyProps={{ fontWeight: 700, color: '#111' }} />
        </ListItemButton>
      </List>
    </Box>
  );
}

function Shell({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const isMdUp = useMediaQuery("(min-width:900px)");

  const drawer = (
    <Sidebar
      open={open}
      onClose={() => setOpen(false)}
      isAdmin={Boolean(user?.isAdmin || user?.role === "admin")}
      onLogout={onLogout}
    />
  );

  return (
    <Box sx={{
      minHeight: "100vh",
      background: "#ffffff"
    }}>
      <AppBar elevation={0} position="sticky"
        sx={{ bgcolor: "#ffffff", backdropFilter: "saturate(120%) blur(6px)", borderBottom: "1px solid rgba(255,255,255,.08)" }}>
        <Toolbar>
          {!isMdUp && (
            <IconButton edge="start" color="inherit" onClick={() => setOpen(true)} sx={{ mr: 1 }}>
              <MenuIcon />
            </IconButton>
          )}
          <Typography sx={{ fontWeight: 800, letterSpacing: .2, flex: 1, textAlign: "center", color: "black", fontSize: "2.5rem" }}>MIOYM Deal Finder</Typography>
        </Toolbar>
      </AppBar>

      {/* Sidebar */}
      {isMdUp ? (
        <Drawer variant="permanent" open
          PaperProps={{ sx: {
            width: 200,
            borderRight: "1px solid rgba(255,255,255,.08)",
            bgcolor: "lightgray",
            overflow: "hidden",
            scrollbarWidth: "none",
            msOverflowStyle: "none",
            "&::-webkit-scrollbar": { width: 0, height: 0, display: "none" }
          } }}>
          {drawer}
        </Drawer>
      ) : (
        <Drawer open={open} onClose={() => setOpen(false)}
          PaperProps={{ sx: {
            width: 200,
            bgcolor: "lightgray",
            overflow: "hidden",
            scrollbarWidth: "none",
            msOverflowStyle: "none",
            "&::-webkit-scrollbar": { width: 0, height: 0, display: "none" }
          } }}>
          <Sidebar
            open={open}
            onClose={() => setOpen(false)}
            isAdmin={Boolean(user?.isAdmin || user?.role === "admin")}
            onLogout={onLogout}
          />
        </Drawer>
      )}

      {/* Main content */}
      <Box sx={{ ml: { md: "200px" }, pl: 1, pr: 2, py: 2, overflowX: "auto" }}>
        <Outlet />
      </Box>
    </Box>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authed, setAuthed] = useState(Boolean(localStorage.getItem("authToken")));

  useEffect(() => {
    if (!authed) return;
    (async () => {
      const v = await verify(); // { success, user }
      if (v?.success) {
        setUser(v.user || null);
      } else {
        localStorage.removeItem("authToken");
        setAuthed(false);
      }
    })();
  }, [authed]);

  const onLogout = () => {
    clearToken();
    setUser(null);
    setAuthed(false);
    window.location.href = "/login";
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login verify={() => setAuthed(true)} />} />
          <Route
            path="/"
            element={
              <Protected>
                <Shell user={user} onLogout={onLogout} />
              </Protected>
            }
          >
            {/* Default route: Everyone goes to Deals */}
            <Route index element={<Navigate to="/deals" replace />} />
            {/* Deals - accessible to everyone */}
            <Route path="deals" element={<Deals />} />
            {/* Deal Pipeline Pages */}
            <Route path="email-sent" element={<EmailSent />} />
            <Route path="follow-up" element={<FollowUp />} />
            <Route path="deal-status" element={<DealStatus />} />
            {/* Pending AMV - shows addresses waiting for BofA valuation (Admin only) */}
            <Route path="pending-amv" element={
              (user?.isAdmin || user?.role === "admin") ? <PendingAMV /> : <Navigate to="/deals" replace />
            } />
            {/* Agent Lookup - single address lookup (Admin only) */}
            <Route path="agent-lookup" element={
              (user?.isAdmin || user?.role === "admin") ? <AgentLookup /> : <Navigate to="/deals" replace />
            } />
            {/* Pages accessible to everyone */}
            <Route path="all-addresses" element={<ScrapedDeals />} />
            {/* Admin-only fetcher pages */}
            <Route path="privy-fetcher" element={
              (user?.isAdmin || user?.role === "admin") ? <PrivyFetcher /> : <Navigate to="/deals" replace />
            } />
            <Route path="redfin-fetcher" element={
              (user?.isAdmin || user?.role === "admin") ? <RedfinFetcher /> : <Navigate to="/deals" replace />
            } />
            <Route path="bofa-viewer" element={
              (user?.isAdmin || user?.role === "admin") ? <BofaViewer /> : <Navigate to="/deals" replace />
            } />
            {/* AMV Speed Test - New Redfin AMV API test page */}
            <Route path="amv-speed-test" element={
              (user?.isAdmin || user?.role === "admin") ? <RedfinAMVTest /> : <Navigate to="/deals" replace />
            } />
            {/* Redfin AMV Lookup - Simple AMV lookup by URL/Property ID */}
            <Route path="redfin-amv-lookup" element={
              (user?.isAdmin || user?.role === "admin") ? <RedfinAMVLookup /> : <Navigate to="/deals" replace />
            } />
            {/* <Route path="agent-fetcher" element={<AgentFetcher />} /> */}{/* Commented out - can enable later */}
            {/* Admin-only routes */}
            <Route path="manage-subadmins" element={
              (user?.isAdmin || user?.role === "admin") ? <ManageSubadmins /> : <Navigate to="/deals" replace />
            } />
            <Route path="users" element={
              (user?.isAdmin || user?.role === "admin") ? <Users /> : <Navigate to="/deals" replace />
            } />
          </Route>
          <Route path="*" element={<Navigate to="/deals" replace />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}