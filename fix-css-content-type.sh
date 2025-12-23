#!/bin/bash

# Quick script to fix CSS content type and invalidate cache

export AWS_PROFILE="${AWS_PROFILE:-wallyweb}"
BUCKET_NAME="com-wallyweb-homesite"
DISTRIBUTION_ID="E2PMGMSI761RQZ"

echo "🔧 Fixing CSS Content Type"
echo "=========================="
echo ""

# Fix content types
echo "📝 Setting correct content types..."
aws s3 cp s3://$BUCKET_NAME/styles.css s3://$BUCKET_NAME/styles.css \
    --content-type "text/css" \
    --metadata-directive REPLACE \
    --profile "$AWS_PROFILE" > /dev/null

aws s3 cp s3://$BUCKET_NAME/script.js s3://$BUCKET_NAME/script.js \
    --content-type "application/javascript" \
    --metadata-directive REPLACE \
    --profile "$AWS_PROFILE" > /dev/null

aws s3 cp s3://$BUCKET_NAME/index.html s3://$BUCKET_NAME/index.html \
    --content-type "text/html" \
    --metadata-directive REPLACE \
    --profile "$AWS_PROFILE" > /dev/null

# Verify
echo "🔍 Verifying content types..."
CSS_TYPE=$(aws s3api head-object --bucket "$BUCKET_NAME" --key styles.css --profile "$AWS_PROFILE" --query 'ContentType' --output text)
JS_TYPE=$(aws s3api head-object --bucket "$BUCKET_NAME" --key script.js --profile "$AWS_PROFILE" --query 'ContentType' --output text)
HTML_TYPE=$(aws s3api head-object --bucket "$BUCKET_NAME" --key index.html --profile "$AWS_PROFILE" --query 'ContentType' --output text)

echo "   CSS: $CSS_TYPE"
echo "   JS:  $JS_TYPE"
echo "   HTML: $HTML_TYPE"
echo ""

# Invalidate CloudFront
echo "🔄 Invalidating CloudFront cache..."
INVALIDATION_ID=$(aws cloudfront create-invalidation \
    --distribution-id "$DISTRIBUTION_ID" \
    --paths "/*" \
    --profile "$AWS_PROFILE" \
    --query 'Invalidation.Id' \
    --output text \
    --no-cli-pager)

if [ $? -eq 0 ]; then
    echo "✅ Cache invalidation created: $INVALIDATION_ID"
    echo ""
    echo "⏳ Wait 1-2 minutes for cache to clear"
    echo "💡 Then hard refresh your browser (Cmd+Shift+R)"
else
    echo "❌ Failed to create invalidation"
fi

