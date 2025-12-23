#!/bin/bash

# Quick script to check which AWS account you're using

echo "🔍 AWS Account Verification"
echo "=========================="
echo ""

# Check default profile
echo "📋 Default Profile:"
aws sts get-caller-identity 2>/dev/null || echo "  ❌ Not configured"
echo ""

# Check wallyweb profile
echo "📋 WallyWeb Profile:"
aws sts get-caller-identity --profile wallyweb 2>/dev/null || echo "  ❌ Not configured"
echo ""

# List all profiles
echo "📋 All Available Profiles:"
cat ~/.aws/config 2>/dev/null | grep -E "^\[profile |^\[default\]" | sed 's/\[profile //' | sed 's/\[default\]/default/' | sed 's/\]//' | while read profile; do
    if [ "$profile" != "" ]; then
        echo "  - $profile"
        ACCOUNT=$(aws sts get-caller-identity --profile "$profile" 2>/dev/null | grep -o '"Account": "[^"]*"' | cut -d'"' -f4)
        if [ -n "$ACCOUNT" ]; then
            echo "    Account: $ACCOUNT"
        fi
    fi
done

echo ""
echo "💡 To use a specific profile:"
echo "   export AWS_PROFILE=wallyweb"
echo "   ./deploy-s3.sh"
echo ""


