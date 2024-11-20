AWS_VERSION=$(aws --version 2>&1 | cut -d/ -f2 | cut -d. -f1)
echo "aws-cli/$AWS_VERSION"

if [ "$AWS_VERSION" -lt 2 ]; then
    echo "Skipping .npmrc generation because AWS CLI version is less than 2"
else
    echo "Generating .npmrc"
    REPO_ENDPOINT=$(aws codeartifact get-repository-endpoint --domain roo --repository roo-dev --format npm | jq -r '.repositoryEndpoint')
    echo "registry=$REPO_ENDPOINT" > .npmrc

    CODEARTIFACT_AUTH_TOKEN=$(aws codeartifact get-authorization-token --domain roo --query authorizationToken --output text)

    REPO_PATH=$(echo $REPO_ENDPOINT | sed 's/https://g')
    echo "$REPO_PATH:_authToken=$CODEARTIFACT_AUTH_TOKEN" >> .npmrc
fi