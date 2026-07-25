import { ArrowLeft } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

type LegalNavigationState = {
  from?: string;
};

const allowedReturnPaths = new Set(["/settings", "/support"]);

const LegalBackButton = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const requestedPath = (location.state as LegalNavigationState | null)?.from;

  const handleBack = () => {
    if (requestedPath && allowedReturnPaths.has(requestedPath)) {
      navigate(requestedPath);
      return;
    }

    if (Number(window.history.state?.idx || 0) > 0) {
      navigate(-1);
      return;
    }

    navigate("/settings");
  };

  return (
    <button
      type="button"
      onClick={handleBack}
      className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="mr-2 h-4 w-4" />
      Back
    </button>
  );
};

export default LegalBackButton;
