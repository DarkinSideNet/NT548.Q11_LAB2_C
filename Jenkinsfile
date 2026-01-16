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

    // Derived
    ECR_REGISTRY = "${env.AWS_ACCOUNT_ID}.dkr.ecr.${env.AWS_REGION}.amazonaws.com"
  }

  stages {
    stage('Init') {
      steps {
        script {
          env.IMAGE_TAG = env.GIT_COMMIT ? env.GIT_COMMIT.take(7) : env.BUILD_NUMBER
          env.IMAGE_A = "${env.ECR_REGISTRY}/${env.ECR_REPO_SERVICE_A}:${env.IMAGE_TAG}"
          env.IMAGE_B = "${env.ECR_REGISTRY}/${env.ECR_REPO_SERVICE_B}:${env.IMAGE_TAG}"
        }

        sh '''#!/usr/bin/env bash
set -euo pipefail

echo "IMAGE_TAG=$IMAGE_TAG"
echo "IMAGE_A=$IMAGE_A"
echo "IMAGE_B=$IMAGE_B"
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

command -v aws >/dev/null
command -v kubectl >/dev/null
command -v docker >/dev/null
'''
      }
    }

    stage('Build & Push (ECR)') {
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

echo "Building $IMAGE_A"
docker build -t "$IMAGE_A" services/service-a

echo "Building $IMAGE_B"
docker build -t "$IMAGE_B" services/service-b

echo "Pushing $IMAGE_A"
docker push "$IMAGE_A"

echo "Pushing $IMAGE_B"
docker push "$IMAGE_B"
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
kubectl apply -n micro-demo -f k8s/service-b-service.yaml
kubectl apply -n micro-demo -f k8s/service-b-deployment.yaml
kubectl apply -n micro-demo -f k8s/service-a-service.yaml
kubectl apply -n micro-demo -f k8s/service-a-deployment.yaml

# Update images to the freshly pushed ECR tags
kubectl -n micro-demo set image deployment/service-b service-b="$IMAGE_B"
kubectl -n micro-demo set image deployment/service-a service-a="$IMAGE_A"

kubectl -n micro-demo rollout status deployment/service-b --timeout=180s
kubectl -n micro-demo rollout status deployment/service-a --timeout=180s

kubectl -n micro-demo get pods -o wide
'''
        }
      }
    }
  }
}
