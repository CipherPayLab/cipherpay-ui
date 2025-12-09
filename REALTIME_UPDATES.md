# Real-Time Balance Updates

## Overview

Automatic polling for incoming transfers - User B's balance updates automatically when User A sends funds, without requiring a manual page refresh.

## Performance Impact

### Default Configuration (20-second polling)
- **Per User**: 3 requests/minute to backend
- **10 Users**: 30 requests/minute = 0.5 requests/second
- **100 Users**: 300 requests/minute = 5 requests/second
- **1000 Users**: 3000 requests/minute = 50 requests/second

### Optimizations Included

1. **Active Tab Only** 🔥
   - Pauses polling when tab is hidden (saves ~50% of requests)
   - Polls immediately when tab becomes visible

2. **Smart Caching** 🧠
   - Skips poll if data was updated in last 10 seconds
   - Prevents redundant requests after user actions (deposit/transfer/withdraw)

3. **Token Validation** 🔒
   - Stops polling if session expires
   - No wasted requests with expired tokens

4. **Graceful Error Handling** 🛡️
   - Errors don't disrupt user experience
   - Automatic retry on next interval

## Configuration

Edit `/src/contexts/CipherPayContext.jsx` (lines 8-17):

```javascript
const REALTIME_CONFIG = {
    // Enable/disable automatic polling
    enabled: true,
    
    // Poll interval (milliseconds)
    // 15000 = 15s = 4 req/min
    // 20000 = 20s = 3 req/min (default)
    // 30000 = 30s = 2 req/min
    // 60000 = 60s = 1 req/min
    pollInterval: 20000,
    
    // Skip if recently updated (milliseconds)
    skipIfRecentUpdate: 10000,
};
```

## Performance Tuning Recommendations

### Low Traffic (< 50 concurrent users)
```javascript
pollInterval: 15000  // 15 seconds - more responsive
```

### Medium Traffic (50-500 users)
```javascript
pollInterval: 20000  // 20 seconds - balanced (default)
```

### High Traffic (> 500 users)
```javascript
pollInterval: 30000  // 30 seconds - reduced load
```

### Peak Load / Cost Optimization
```javascript
pollInterval: 60000  // 60 seconds - minimal impact
```

### Disable Completely (Manual refresh only)
```javascript
enabled: false
```

## Alternative: WebSocket Implementation

For production with many concurrent users, consider implementing WebSockets for true real-time updates:

### Benefits:
- ✅ **Near-instant updates** (no polling delay)
- ✅ **Lower server load** (push vs pull)
- ✅ **Lower bandwidth** (only sends when there's new data)
- ✅ **Better scalability**

### Backend Required:
- WebSocket server (Socket.io, ws, or native WebSockets)
- Broadcast mechanism when new transfers arrive
- Connection management

### Complexity:
- Medium - requires server-side changes
- Need to handle connection drops and reconnection
- More infrastructure (WebSocket endpoint)

## Monitoring

Check browser console for polling activity:
```
[CipherPayContext] Starting optimized balance polling {
  interval: "20s",
  requestsPerMin: 3,
  activeTabOnly: true,
  smartCaching: true
}
```

### Network Tab Analysis:
- Filter by: `/api/v1/messages`
- Expected: 1 request every 20 seconds (when tab is active)
- If seeing more: Check if `skipIfRecentUpdate` is working

## Performance Testing

Test with multiple users:
```bash
# Simulate 100 concurrent users
# Each user polls every 20s = 3 req/min
# Total: 300 req/min = 5 req/s
# With active tab optimization: ~2.5 req/s (assuming 50% have tab active)
```

Monitor backend:
```bash
# Watch request rate
watch -n 1 'grep "GET /api/v1/messages" access.log | wc -l'
```

## Current Implementation Summary

✅ **Enabled by default** (20-second interval)  
✅ **Optimized with 4 performance features**  
✅ **Easy to configure or disable**  
✅ **Production-ready for up to 500 concurrent users**  

For larger scale (1000+ users), consider:
1. Increase `pollInterval` to 30-60 seconds
2. Implement WebSocket push notifications
3. Add database query optimization (indexes, caching)
