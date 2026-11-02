terraform {
  required_version = "1.17.1"

  required_providers {
    github = {
      source  = "integrations/github"
      version = "6.13.0"
    }
  }

  # The bucket goes in `terraform init -backend-config`, so its name stays out of the repo.
  backend "s3" {
    key                  = "terraform/github.tfstate"
    region               = "eu-west-1"
    use_lockfile         = true
    encrypt              = true
    workspace_key_prefix = "terraform/workspaces"
  }
}

provider "github" {
  owner = "Joakamakaka1"
}
