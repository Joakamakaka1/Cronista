terraform {
  required_version = "1.17.1"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.72.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "5.28.1"
    }
  }

  # The bucket goes in `terraform init -backend-config`, so its name stays out of the repo.
  backend "s3" {
    key                  = "terraform/cloudflare.tfstate"
    region               = "eu-west-1"
    use_lockfile         = true
    encrypt              = true
    workspace_key_prefix = "terraform/workspaces"
  }
}

# Takes CLOUDFLARE_API_TOKEN from the environment. It never goes into CI (docs/development.md).
provider "cloudflare" {}

# Route 53 is global; this provider only reads the zone's name servers.
provider "aws" {
  region = "us-east-1"
}
