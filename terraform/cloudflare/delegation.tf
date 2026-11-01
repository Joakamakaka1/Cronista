locals {
  domain    = "jcvstro.dev"
  subdomain = "cronista.jcvstro.dev"
}

# Fails if two public zones share the name, which a deploy without the import could leave behind.
data "aws_route53_zone" "cronista" {
  name         = local.subdomain
  private_zone = false
}

data "cloudflare_zone" "domain" {
  filter = {
    name = local.domain
  }
}

# Replacing the zone changes its name servers, and the next apply moves the delegation with them.
resource "cloudflare_dns_record" "delegation" {
  for_each = toset(data.aws_route53_zone.cronista.name_servers)

  zone_id = data.cloudflare_zone.domain.zone_id
  name    = local.subdomain
  type    = "NS"
  content = each.key
  ttl     = 1
}
