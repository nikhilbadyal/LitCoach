import { Button } from "@components/ui/button";
import { ExternalLink } from "lucide-react";

const FEEDBACK_FORM = "https://www.nikhilbadyal.com/";

function ReportIssueButton() {
    return (
        <Button
            variant="link"
            className="font-light h-5"
            onClick={() => window.open(FEEDBACK_FORM, "_blank", "noopener,noreferrer")}
        >
            <ExternalLink />
            Report Issue?
        </Button>
    );
}

export default ReportIssueButton;
