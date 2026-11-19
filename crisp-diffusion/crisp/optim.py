"""Muon (momentum + Newton-Schulz orthogonalized updates) for hidden 2-D/4-D weights, AdamW for the rest.
Reference algorithm: K. Jordan et al. 2024 (modded-nanogpt / airbench).  FLOPs of the Newton-Schulz
iterations are counted (`flops_per_step`)."""
import torch


def newton_schulz5(G, steps=5):
    a, b, c = 3.4445, -4.7750, 2.0315
    X = G.float()
    transpose = X.shape[0] > X.shape[1]
    if transpose:
        X = X.T
    X = X / (X.norm() + 1e-7)
    for _ in range(steps):
        A = X @ X.T
        B = b * A + c * A @ A
        X = a * X + B @ X
    return X.T if transpose else X


class Muon(torch.optim.Optimizer):
    def __init__(self, params, lr=0.02, momentum=0.95, steps=5):
        super().__init__(params, dict(lr=lr, momentum=momentum, steps=steps))
        self.flops_per_step = 0.0
        for g in self.param_groups:
            for p in g["params"]:
                m, n = p.shape[0], p[0].numel()
                r, k = min(m, n), max(m, n)
                self.flops_per_step += steps * (2 * r * r * k + 2 * r * r * r + 2 * r * r * k)

    @torch.no_grad()
    def step(self):
        for g in self.param_groups:
            for p in g["params"]:
                if p.grad is None:
                    continue
                st = self.state[p]
                if "buf" not in st:
                    st["buf"] = torch.zeros_like(p)
                buf = st["buf"]
                buf.mul_(g["momentum"]).add_(p.grad)
                upd = p.grad.add(buf, alpha=g["momentum"])  # Nesterov
                G = upd.reshape(p.shape[0], -1)
                O = newton_schulz5(G, g["steps"])
                scale = max(1.0, G.shape[0] / G.shape[1]) ** 0.5
                p.add_(O.reshape(p.shape), alpha=-g["lr"] * scale)


def split_params(net):
    """Hidden conv/linear weights -> Muon; input/output convs, norms, biases, embeddings -> Adam."""
    muon, adam = [], []
    for name, p in net.named_parameters():
        if p.ndim >= 2 and not name.startswith(("inp.", "out.", "cemb.", "temb.")):
            muon.append(p)
        else:
            adam.append(p)
    return muon, adam
