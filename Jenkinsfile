pipeline {
  agent any

  options {
    timestamps()
  }

  environment {
    // Required (set in Jenkins job env vars or global env)
    AWS_REGION = "${env.AWS_REGION}"
    AWS_ACCOUNT_ID = "${env.AWS_ACCOUNT_ID}"
    EKS_CLUSTER_NAME = "${env.EKS_CLUSTER_NAME}"
    ECR_REPO_SERVICE_A = "${env.ECR_REPO_SERVICE_A}"
    ECR_REPO_SERVICE_B = "${env.ECR_REPO_SERVICE_B}"
    ECR_REPO_SERVICE_C = "${env.ECR_REPO_SERVICE_C}"

    // Derived
    ECR_REGISTRY = "${env.AWS_ACCOUNT_ID}.dkr.ecr.${env.AWS_REGION}.amazonaws.com"

    // Quality & Security scans
    // Required for SonarQube stage:
    // - SONAR_HOST_URL (e.g. https://sonarqube.yourdomain)
    // - SONAR_PROJECT_KEY (unique key in SonarQube)
    // - Jenkins secret text credential id 'sonar-token'
    SONAR_HOST_URL = "${env.SONAR_HOST_URL}"
    SONAR_PROJECT_KEY = "${env.SONAR_PROJECT_KEY}"

    // Optional security tools
    // Set TRIVY_ENABLED=true to scan images after build (recommended for labs)
    // Set SNYK_ENABLED=true to run Snyk scans (requires credential id 'snyk-token')
    TRIVY_ENABLED = "${env.TRIVY_ENABLED}"
    SNYK_ENABLED = "${env.SNYK_ENABLED}"
  }

  stages {
    stage('Init') {
      steps {
        script {
          env.IMAGE_TAG = env.GIT_COMMIT ? env.GIT_COMMIT.take(7) : env.BUILD_NUMBER
          env.IMAGE_A = "${env.ECR_REGISTRY}/${env.ECR_REPO_SERVICE_A}:${env.IMAGE_TAG}"
          env.IMAGE_B = "${env.ECR_REGISTRY}/${env.ECR_REPO_SERVICE_B}:${env.IMAGE_TAG}"
          env.IMAGE_C = "${env.ECR_REGISTRY}/${env.ECR_REPO_SERVICE_C}:${env.IMAGE_TAG}"
        }

        sh '''#!/usr/bin/env bash
set -euo pipefail

echo "IMAGE_TAG=$IMAGE_TAG"
echo "IMAGE_A=$IMAGE_A"
echo "IMAGE_B=$IMAGE_B"
echo "IMAGE_C=$IMAGE_C"
'''
      }
    }

    stage('Precheck') {
      steps {
        sh '''#!/usr/bin/env bash
set -euo pipefail

echo "AWS_REGION=$AWS_REGION"
echo "AWS_ACCOUNT_ID=$AWS_ACCOUNT_ID"
echo "EKS_CLUSTER_NAME=$EKS_CLUSTER_NAME"
echo "ECR_REPO_SERVICE_A=$ECR_REPO_SERVICE_A"
echo "ECR_REPO_SERVICE_B=$ECR_REPO_SERVICE_B"
echo "ECR_REPO_SERVICE_C=$ECR_REPO_SERVICE_C"

echo "SONAR_HOST_URL=${SONAR_HOST_URL:-}"
echo "SONAR_PROJECT_KEY=${SONAR_PROJECT_KEY:-}"
echo "TRIVY_ENABLED=${TRIVY_ENABLED:-}"
echo "SNYK_ENABLED=${SNYK_ENABLED:-}"

require_var() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" || "$value" == "null" ]]; then
    echo "ERROR: missing required env var '$name'. Set it in Jenkins job environment variables." >&2
    exit 1
  fi
}

require_var AWS_REGION
require_var AWS_ACCOUNT_ID
require_var EKS_CLUSTER_NAME
require_var ECR_REPO_SERVICE_A
require_var ECR_REPO_SERVICE_B
require_var ECR_REPO_SERVICE_C

# SonarQube is intended to be always-on. Fail early with a clear message if missing.
require_var SONAR_HOST_URL
require_var SONAR_PROJECT_KEY

for cmd in aws kubectl docker; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: missing required tool '$cmd' on this Jenkins agent (not in PATH)." >&2
    exit 1
  fi
done

echo "aws version: $(aws --version 2>&1)"
echo "kubectl version: $(kubectl version --client --short 2>/dev/null || kubectl version --client 2>/dev/null || true)"
echo "docker version: $(docker --version 2>&1)"
'''
      }
    }

    stage('SonarQube Scan') {
      steps {
        withCredentials([
          string(credentialsId: 'sonar-token', variable: 'SONAR_TOKEN')
        ]) {
          sh '''#!/usr/bin/env bash
set -euo pipefail

# If SonarQube runs on the same host and SONAR_HOST_URL points to localhost,
# the scanner container must use host networking to reach it.
DOCKER_NET=""
if [[ "$SONAR_HOST_URL" == *"://localhost"* || "$SONAR_HOST_URL" == *"://127.0.0.1"* ]]; then
  DOCKER_NET="--network host"
fi

# Wait until SonarQube is ready (avoid flaky first-run)
echo "Waiting for SonarQube to be UP at $SONAR_HOST_URL ..."
for i in $(seq 1 60); do
  if docker run --rm $DOCKER_NET curlimages/curl:8.5.0 -fsS "$SONAR_HOST_URL/api/system/status" \
    | grep -q '"status":"UP"'; then
    echo "SonarQube is UP"
    break
  fi
  echo "  not ready yet ($i/60)"; sleep 2
  if [[ "$i" == "60" ]]; then
    echo "ERROR: SonarQube not ready after 120s" >&2
    exit 1
  fi
done

if [[ ! -f sonar-project.properties ]]; then
  echo "ERROR: missing sonar-project.properties at repo root" >&2
  exit 1
fi

echo "Running SonarQube scan via Dockerized sonar-scanner..."

# Note: using :latest for convenience; pin this tag for fully reproducible builds.

# Optional: pass branch name if Jenkins provides it
BRANCH_ARG=""
if [[ -n "${BRANCH_NAME:-}" ]]; then
  BRANCH_ARG="-Dsonar.branch.name=${BRANCH_NAME}"
fi

docker run --rm $DOCKER_NET \
  -e SONAR_HOST_URL="$SONAR_HOST_URL" \
  -e SONAR_TOKEN="$SONAR_TOKEN" \
  -v "$WORKSPACE:/usr/src" \
  -w /usr/src \
  sonarsource/sonar-scanner-cli:latest \
  sonar-scanner \
    -Dsonar.host.url="$SONAR_HOST_URL" \
    -Dsonar.token="$SONAR_TOKEN" \
    -Dsonar.projectKey="$SONAR_PROJECT_KEY" \
    $BRANCH_ARG
'''
        }
      }
    }

    stage('Build Images') {
      steps {
        sh '''#!/usr/bin/env bash
set -euo pipefail
echo "Building $IMAGE_A"
docker build -t "$IMAGE_A" services/service-a

echo "Building $IMAGE_B"
docker build -t "$IMAGE_B" services/service-b

docker build -t "$IMAGE_C" services/service-c
'''
      }
    }

    stage('Trivy Scan (optional)') {
      when {
        expression { return env.TRIVY_ENABLED == 'true' }
      }
      steps {
        sh '''#!/usr/bin/env bash
set -euo pipefail

echo "Running Trivy image scan (HIGH,CRITICAL)..."

for img in "$IMAGE_A" "$IMAGE_B" "$IMAGE_C"; do
  echo "Scanning $img"
  docker run --rm \
    -v /var/run/docker.sock:/var/run/docker.sock \
    aquasec/trivy:0.49.1 \
      image --no-progress --severity HIGH,CRITICAL --exit-code 1 "$img"
done
'''
      }
    }

    stage('Snyk Scan (optional)') {
      when {
        expression { return env.SNYK_ENABLED == 'true' }
      }
      steps {
        withCredentials([
          string(credentialsId: 'snyk-token', variable: 'SNYK_TOKEN')
        ]) {
          sh '''#!/usr/bin/env bash
set -euo pipefail

echo "Running Snyk container scan (severity>=high)..."

for img in "$IMAGE_A" "$IMAGE_B" "$IMAGE_C"; do
  echo "Scanning $img"
  docker run --rm \
    -e SNYK_TOKEN="$SNYK_TOKEN" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    snyk/snyk:docker \
      snyk container test "$img" --severity-threshold=high
done
'''
        }
      }
    }

    stage('Push Images (ECR)') {
      steps {
        withCredentials([
          string(credentialsId: 'aws-access-key-id', variable: 'AWS_ACCESS_KEY_ID'),
          string(credentialsId: 'aws-secret-access-key', variable: 'AWS_SECRET_ACCESS_KEY')
        ]) {
          sh '''#!/usr/bin/env bash
set -euo pipefail

aws --version

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY"

echo "Pushing $IMAGE_A"
docker push "$IMAGE_A"

echo "Pushing $IMAGE_B"
docker push "$IMAGE_B"

echo "Pushing $IMAGE_C"
docker push "$IMAGE_C"
'''
        }
      }
    }

    stage('Deploy to EKS') {
      steps {
        withCredentials([
          string(credentialsId: 'aws-access-key-id', variable: 'AWS_ACCESS_KEY_ID'),
          string(credentialsId: 'aws-secret-access-key', variable: 'AWS_SECRET_ACCESS_KEY')
        ]) {
          sh '''#!/usr/bin/env bash
set -euo pipefail

aws eks update-kubeconfig --region "$AWS_REGION" --name "$EKS_CLUSTER_NAME"

kubectl apply -f k8s/namespace.yaml

# Optional: create EBS CSI storageclass if Jenkins has cluster-level RBAC
kubectl apply -f k8s/storageclass-gp2-csi.yaml 2>/dev/null || echo "WARN: could not apply storageclass-gp2-csi (need cluster-admin). Apply it manually once if PVC is Pending."

kubectl apply -n micro-demo -f k8s/postgres-secret.yaml
kubectl apply -n micro-demo -f k8s/postgres-service.yaml
kubectl apply -n micro-demo -f k8s/postgres-statefulset.yaml

# Wait for PostgreSQL to be ready before deploying services that depend on it
kubectl -n micro-demo rollout status statefulset/postgres --timeout=300s

kubectl apply -n micro-demo -f k8s/service-b-service.yaml
kubectl apply -n micro-demo -f k8s/service-b-deployment.yaml
kubectl apply -n micro-demo -f k8s/service-c-service.yaml
kubectl apply -n micro-demo -f k8s/service-c-deployment.yaml
kubectl apply -n micro-demo -f k8s/service-a-service.yaml
kubectl apply -n micro-demo -f k8s/service-a-deployment.yaml
kubectl apply -n micro-demo -f k8s/service-a-ingress.yaml

# Update images to the freshly pushed ECR tags
kubectl -n micro-demo set image deployment/service-b service-b="$IMAGE_B"
kubectl -n micro-demo set image deployment/service-c service-c="$IMAGE_C"
kubectl -n micro-demo set image deployment/service-a service-a="$IMAGE_A"

rollout_or_debug() {
  local kind="$1"
  local name="$2"
  if ! kubectl -n micro-demo rollout status "$kind/$name" --timeout=300s; then
    echo "\n==== DEBUG: rollout failed for $kind/$name ====" >&2
    kubectl -n micro-demo get pods -o wide || true
    kubectl -n micro-demo describe "$kind/$name" || true
    kubectl -n micro-demo get events --sort-by=.lastTimestamp | tail -n 80 || true
    kubectl -n micro-demo logs "$kind/$name" --tail=200 || true
    echo "==== END DEBUG ====" >&2
    return 1
  fi
}

rollout_or_debug deployment service-b
rollout_or_debug deployment service-c
rollout_or_debug deployment service-a

kubectl -n micro-demo get pods -o wide
'''
        }
      }
    }
  }
}
