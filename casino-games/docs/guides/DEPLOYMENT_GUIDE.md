# 🚀 Deployment Guide - Fix Avatar Sync Issues

## Issues Found

1. ✅ **Fixed:** Invalid `setLocalPlayer` calls in useLobby.js (was causing errors)
2. ✅ **Fixed:** Missing `nickname` dependency in useEffect
3. ⚠️ **CRITICAL:** Backend Lambda functions still have OLD code - need to deploy!

---

## 🔴 CRITICAL: Deploy Backend First!

The Lambda functions on AWS still have the old code that doesn't support avatar data. You MUST deploy the backend for avatars to sync properly.

### Step 1: Deploy Backend (AWS CDK)

```bash
# Make sure you're in the project root
cd d:\GitHubProjects\casino888

# Deploy to AWS (this will update all Lambda functions)
npm run deploy
# OR
cdk deploy
```

**What this does:**
- Updates `websocket/connect` Lambda to accept and store avatar data
- Updates `websocket/move` Lambda to store direction
- Updates DynamoDB tables if needed
- Takes about 2-5 minutes

**Expected output:**
```
✅ CasinoInfraStack

Outputs:
CasinoInfraStack.WebSocketApiUrl = wss://...
...

Stack ARN:
arn:aws:cloudformation:...
```

---

### Step 2: Commit and Push Frontend Changes

```bash
# Stage all changes
git add -A

# Commit
git commit -m "fix: Avatar sync and lobby status fixes"

# Push to GitHub
git push
```

---

### Step 3: Deploy Frontend (Netlify)

Netlify should auto-deploy when you push to GitHub. If not:

1. Go to Netlify dashboard
2. Click "Trigger deploy"
3. Wait for build to complete (~1-2 minutes)

---

## 🧪 Testing After Deployment

### Test 1: Avatar Sync
1. **User A:** Customize avatar (Profile tab) - choose red color, 100px size
2. **User A:** Go to Lobby tab
3. **User B:** Connect to lobby
4. **Expected:** User B should see User A with RED avatar, 100px size

### Test 2: Real-Time Movement
1. **User A:** Move with WASD keys
2. **User B:** Watch User A
3. **Expected:** User B should see User A moving smoothly in real-time

### Test 3: Lobby Status
1. **User A:** Connect to lobby
2. **Check:** Status should show "connected" (green)
3. **User A:** Close browser
4. **User B:** Should see User A disappear from player list

---

## 🐛 Troubleshooting

### Problem: Avatars still don't match

**Solution:**
1. Check browser console for errors
2. Verify backend was deployed: `aws lambda list-functions | grep websocket`
3. Check CloudWatch logs for Lambda errors
4. Clear browser cache and hard refresh (Ctrl+Shift+R)

### Problem: "Lobby status: disconnected"

**Solution:**
1. Check WebSocket URL in browser console
2. Verify AWS API Gateway is deployed
3. Check browser console for WebSocket connection errors
4. Try reconnecting (refresh page)

### Problem: Movement doesn't sync

**Solution:**
1. Open browser console
2. Check for WebSocket send errors
3. Verify `sendMove` function is being called (add console.log)
4. Check Lambda move handler CloudWatch logs

---

## 📊 Verify Deployment

### Check Backend Deployment

```bash
# List Lambda functions
aws lambda list-functions --query 'Functions[?contains(FunctionName, `websocket`)].FunctionName'

# Check last modified date (should be recent)
aws lambda get-function --function-name <your-connect-function-name> --query 'Configuration.LastModified'
```

### Check Frontend Deployment

1. Open browser DevTools (F12)
2. Go to Network tab
3. Filter by "WS" (WebSocket)
4. Connect to lobby
5. Look for WebSocket connection with avatar parameters:
   ```
   wss://...?token=xxx&userId=xxx&nickname=xxx&avatarColor=%234a90e2&avatarSize=80
   ```

---

## 🔍 Debug Mode

Add this to browser console to see WebSocket messages:

```javascript
// In browser console
const originalSend = WebSocket.prototype.send;
WebSocket.prototype.send = function(data) {
  console.log('📤 WS Send:', JSON.parse(data));
  return originalSend.call(this, data);
};

const originalOnMessage = WebSocket.prototype.onmessage;
WebSocket.prototype.onmessage = function(event) {
  console.log('📥 WS Receive:', JSON.parse(event.data));
  if (originalOnMessage) originalOnMessage.call(this, event);
};
```

---

## ✅ Success Criteria

After deployment, you should see:

1. ✅ Lobby status shows "connected" (not "disconnected")
2. ✅ Custom avatars appear correctly for all players
3. ✅ Real-time movement works smoothly
4. ✅ Player directory shows online/offline status
5. ✅ No errors in browser console
6. ✅ No errors in CloudWatch logs

---

## 📝 Changes Made in This Fix

### Frontend (`useLobby.js`)
- ❌ Removed invalid `setLocalPlayer` calls (was causing crashes)
- ✅ Added `nickname` to useEffect dependencies
- ✅ Simplified message handling (removed duplicate logic)

### Why This Matters
- The `setLocalPlayer` function doesn't exist in `useLobby.js`
- It was trying to update state that's managed in `CasinoMap.tsx`
- This was causing JavaScript errors that broke the lobby
- Now the lobby hook only manages the player list from the server
- Local player movement is handled entirely in `CasinoMap.tsx`

---

## 🎯 Next Steps

1. **Deploy backend:** `npm run deploy` or `cdk deploy`
2. **Commit changes:** `git add -A && git commit -m "fix: lobby sync issues"`
3. **Push to GitHub:** `git push`
4. **Wait for Netlify:** Auto-deploys in ~2 minutes
5. **Test with friend:** Open 2 browsers and verify everything works
6. **Celebrate! 🎉**

---

## 📞 Need Help?

If deployment fails:
1. Check AWS credentials: `aws sts get-caller-identity`
2. Check CDK version: `cdk --version`
3. Check for CloudFormation errors in AWS Console
4. Share error messages for debugging

---

**Last Updated:** 2025-12-11  
**Status:** Ready to Deploy
