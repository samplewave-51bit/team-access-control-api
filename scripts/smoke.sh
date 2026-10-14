#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Smoke Test Script for Team Access Control API (v1)
# Flow: Health Check -> Register -> Login -> Create Org -> List Members
# ==============================================================================

BASE_URL="${1:-${API_URL:-http://localhost:3000}}"
# Strip trailing slash if present
BASE_URL="${BASE_URL%/}"
API_V1="${BASE_URL}/api/v1"

echo "=========================================================="
echo " Starting Smoke Tests against: ${BASE_URL}"
echo "=========================================================="

# Helper function to extract JSON fields using Node.js (zero external dependencies)
json_val() {
  local json="$1"
  local expr="$2"
  node -e "
    try {
      const data = JSON.parse(process.argv[1]);
      const val = ${expr};
      if (val !== undefined && val !== null) {
        console.log(typeof val === 'object' ? JSON.stringify(val) : val);
      }
    } catch (e) {
      process.exit(1);
    }
  " "$json"
}

# 1. Health Check
echo "--> 1. Verifying service health (GET ${API_V1}/health)..."
HEALTH_RESP=$(curl -sS -f "${API_V1}/health" || { echo "FAILED: Health check failed"; exit 1; })
STATUS=$(json_val "$HEALTH_RESP" "data.status")
if [ "$STATUS" != "ok" ] && [ "$STATUS" != "healthy" ]; then
  echo "FAILED: Unexpected health status: $HEALTH_RESP"
  exit 1
fi
echo "    Health status: $STATUS (UP)"

# 2. Register
TIMESTAMP=$(date +%s)
RAND_ID=$((RANDOM % 9000 + 1000))
SMOKE_EMAIL="smoke_${TIMESTAMP}_${RAND_ID}@example.com"
SMOKE_PASS="SmokePass123!@#"
SMOKE_NAME="Smoke Runner ${RAND_ID}"

echo "--> 2. Registering new user (${SMOKE_EMAIL})..."
REGISTER_PAYLOAD=$(node -e "console.log(JSON.stringify({ email: process.argv[1], password: process.argv[2], name: process.argv[3] }))" "$SMOKE_EMAIL" "$SMOKE_PASS" "$SMOKE_NAME")

REGISTER_RESP=$(curl -sS -X POST "${API_V1}/auth/register" \
  -H "Content-Type: application/json" \
  -d "$REGISTER_PAYLOAD")

REGISTERED_USER_ID=$(json_val "$REGISTER_RESP" "data.user.id")
if [ -z "$REGISTERED_USER_ID" ]; then
  echo "FAILED: Registration failed. Response: $REGISTER_RESP"
  exit 1
fi
echo "    User registered successfully. ID: ${REGISTERED_USER_ID}"

# 3. Login
echo "--> 3. Logging in with registered credentials..."
LOGIN_PAYLOAD=$(node -e "console.log(JSON.stringify({ email: process.argv[1], password: process.argv[2] }))" "$SMOKE_EMAIL" "$SMOKE_PASS")

LOGIN_RESP=$(curl -sS -X POST "${API_V1}/auth/login" \
  -H "Content-Type: application/json" \
  -d "$LOGIN_PAYLOAD")

ACCESS_TOKEN=$(json_val "$LOGIN_RESP" "data.accessToken")
if [ -z "$ACCESS_TOKEN" ]; then
  echo "FAILED: Login failed. Response: $LOGIN_RESP"
  exit 1
fi
echo "    Login successful. Access token received."

# 4. Create Organization
ORG_NAME="Smoke Org ${TIMESTAMP}"
echo "--> 4. Creating organization (${ORG_NAME})..."
CREATE_ORG_PAYLOAD=$(node -e "console.log(JSON.stringify({ name: process.argv[1] }))" "$ORG_NAME")

ORG_RESP=$(curl -sS -X POST "${API_V1}/orgs" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -d "$CREATE_ORG_PAYLOAD")

ORG_ID=$(json_val "$ORG_RESP" "data.organization.id")
if [ -z "$ORG_ID" ]; then
  echo "FAILED: Create organization failed. Response: $ORG_RESP"
  exit 1
fi
echo "    Organization created successfully. Org ID: ${ORG_ID}"

# 5. List Members
echo "--> 5. Listing members of organization (${ORG_ID})..."
MEMBERS_RESP=$(curl -sS -X GET "${API_V1}/orgs/${ORG_ID}/members" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}")

MEMBER_COUNT=$(json_val "$MEMBERS_RESP" "data.members.length")
if [ -z "$MEMBER_COUNT" ] || [ "$MEMBER_COUNT" -lt 1 ]; then
  echo "FAILED: Member listing failed. Response: $MEMBERS_RESP"
  exit 1
fi

MEMBER_ROLE=$(json_val "$MEMBERS_RESP" "data.members[0].role.name")
echo "    Found ${MEMBER_COUNT} member(s). First member role: ${MEMBER_ROLE}"

if [ "$MEMBER_ROLE" != "owner" ]; then
  echo "FAILED: Expected creator role to be 'owner', got '${MEMBER_ROLE}'"
  exit 1
fi

echo "=========================================================="
echo " All Smoke Tests Passed Successfully! [OK]"
echo "=========================================================="
