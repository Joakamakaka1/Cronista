locals {
  # A new blocking check goes here in the PR that turns it on (docs/delivery.md).
  required_checks = ["code", "db", "terraform", "secrets", "snyk", "snyk-code", "pr-title"]

  # The GitHub Actions app: only its workflows can report these checks.
  github_actions_app_id = 15368
}

resource "github_repository_ruleset" "master" {
  name        = "master"
  repository  = github_repository.cronista.name
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"]
      exclude = []
    }
  }

  rules {
    deletion                = true
    non_fast_forward        = true
    required_linear_history = true

    pull_request {
      allowed_merge_methods = ["squash"]
      # A single developer cannot approve their own PRs: the checks are the brake.
      required_approving_review_count = 0
    }

    required_status_checks {
      strict_required_status_checks_policy = true

      dynamic "required_check" {
        for_each = local.required_checks

        content {
          context        = required_check.value
          integration_id = local.github_actions_app_id
        }
      }
    }
  }
}
