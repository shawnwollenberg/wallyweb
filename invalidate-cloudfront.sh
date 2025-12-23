#!/bin/bash

# CloudFront Cache Invalidation Script
# This clears the CloudFront cache so new files are served

# Use wallyweb profile if AWS_PROFILE not set
export AWS_PROFILE="${AWS_PROFILE:-wallyweb}"

echo "🔄 Invalidating CloudFront cache..."

# CloudFront Distribution ID (update if different)
DISTRIBUTION_ID="E2PMGMSI761RQZ"

# Invalidate all files (use /* to clear everything)
echo "📋 Creating invalidation for all files..."
INVALIDATION_ID=$(aws cloudfront create-invalidation \
    --distribution-id "$DISTRIBUTION_ID" \
    --paths "/*" \
    --profile "$AWS_PROFILE" \
    --query 'Invalidation.Id' \
    --output text)

if [ $? -eq 0 ]; then
    echo "✅ Invalidation created successfully!"
    echo "📋 Invalidation ID: $INVALIDATION_ID"
    echo ""
    echo "⏳ Cache invalidation typically takes 1-5 minutes to complete."
    echo "💡 You can check status with:"
    echo "   aws cloudfront get-invalidation --distribution-id $DISTRIBUTION_ID --id $INVALIDATION_ID --profile $AWS_PROFILE"
else
    echo "❌ Failed to create invalidation"
    exit 1
fi

